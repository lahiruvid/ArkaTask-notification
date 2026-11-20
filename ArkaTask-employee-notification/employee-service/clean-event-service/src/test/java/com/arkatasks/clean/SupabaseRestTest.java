package com.arkatasks.clean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;

/** PostgREST calls against a local HTTP server. No real project is contacted. */
class SupabaseRestTest {
  static final String ANON = SupabaseKeysFileTest.fakeJwt("anon");
  static final CleanEvent EVENT = CleanOutboxTest.EVENT;

  record Seen(String method, String path, String query, String apiKey, String prefer, String body) {}

  @Test
  void insertIgnoresDuplicatesAndSendsOnlyTheAnonKey() throws Exception {
    List<Seen> seen = new CopyOnWriteArrayList<>();
    withServer(exchange -> {
      seen.add(capture(exchange));
      respond(exchange, 201, "");
    }, base -> rest().insertOutbox(new SupabaseKeysFile.Creds(base, ANON), EVENT));
    Seen call = seen.get(0);
    assertEquals("POST", call.method());
    assertEquals("/rest/v1/clean_outbox", call.path());
    assertTrue(call.query().contains("on_conflict=apartment_id,date,employee_id"));
    assertEquals("resolution=ignore-duplicates,return=minimal", call.prefer());
    assertEquals(ANON, call.apiKey());
    assertTrue(call.body().contains("\"status\":\"PENDING\""));
    assertTrue(call.body().contains("\"apartment_name\":\"Via Roma\""));
  }

  @Test
  void pendingRowsBecomeEvents() throws Exception {
    String rows = "[{\"apartment_id\":\"a1\",\"date\":\"2026-11-20\",\"employee_id\":\"e1\",\"employee_name\":\"Ana\","
        + "\"employee_phone\":\"+39 333\",\"apartment_name\":\"Via Roma\",\"clean_time\":\"10:00\"}]";
    List<Seen> seen = new CopyOnWriteArrayList<>();
    withServer(exchange -> {
      seen.add(capture(exchange));
      respond(exchange, 200, rows);
    }, base -> assertEquals(List.of(EVENT), rest().pendingOutbox(new SupabaseKeysFile.Creds(base, ANON), 20)));
    assertTrue(seen.get(0).query().contains("status=eq.PENDING"));
    assertTrue(seen.get(0).query().contains("order=created_at.asc"));
  }

  @Test
  void markRelayedFailsWhenNoRowChanged() throws Exception {
    withServer(exchange -> respond(exchange, 200, "[]"), base ->
        assertThrows(SupabaseRest.Unavailable.class,
            () -> rest().markRelayed(new SupabaseKeysFile.Creds(base, ANON), EVENT)));
  }

  @Test
  void markRelayedFiltersOnTheFullKey() throws Exception {
    List<Seen> seen = new CopyOnWriteArrayList<>();
    withServer(exchange -> {
      seen.add(capture(exchange));
      respond(exchange, 200, "[{\"apartment_id\":\"a1\"}]");
    }, base -> rest().markRelayed(new SupabaseKeysFile.Creds(base, ANON), EVENT));
    Seen call = seen.get(0);
    assertEquals("PATCH", call.method());
    assertTrue(call.query().contains("apartment_id=eq.a1"));
    assertTrue(call.query().contains("date=eq.2026-11-20"));
    assertTrue(call.query().contains("employee_id=eq.e1"));
    assertTrue(call.query().contains("status=eq.PENDING"));
    assertTrue(call.body().contains("\"status\":\"RELAYED\""));
  }

  @Test
  void apartmentNameComesFromTheEmployeesJob() throws Exception {
    String state = "[{\"payload\":{\"jobs\":[{\"property_id\":\"a1\",\"date\":\"2026-11-20\",\"place_name\":\"Via Roma\","
        + "\"job_assignments\":[{\"employee_id\":\"e1\"}]}]}}]";
    withServer(exchange -> respond(exchange, 200, state), base -> {
      var creds = new SupabaseKeysFile.Creds(base, ANON);
      assertEquals("Via Roma", rest().apartmentName(creds, "a1", "2026-11-20", "e1"));
      assertEquals("a1", rest().apartmentName(creds, "a1", "2026-11-20", "someone-else"));
    });
  }

  @Test
  void outboxHasReadsOneRow() throws Exception {
    withServer(exchange -> respond(exchange, 200, "[]"), base ->
        assertFalse(rest().outboxHas(new SupabaseKeysFile.Creds(base, ANON), "a1", "2026-11-20", "e1")));
    withServer(exchange -> respond(exchange, 200, "[{\"apartment_id\":\"a1\"}]"), base ->
        assertTrue(rest().outboxHas(new SupabaseKeysFile.Creds(base, ANON), "a1", "2026-11-20", "e1")));
  }

  @Test
  void httpErrorsAndSecretKeysAreRefused() throws Exception {
    withServer(exchange -> respond(exchange, 401, "{}"), base -> assertThrows(SupabaseRest.Unavailable.class,
        () -> rest().insertOutbox(new SupabaseKeysFile.Creds(base, ANON), EVENT)));
    withServer(exchange -> {
      throw new AssertionError("a non-anon key must not be sent to Supabase");
    }, base -> assertThrows(SupabaseKeysFile.RejectedKeys.class,
        () -> rest().pendingOutbox(new SupabaseKeysFile.Creds(base, SupabaseKeysFileTest.fakeJwt("service_role")), 1)));
  }

  private static SupabaseRest rest() {
    return new SupabaseRest(HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build(),
        new ObjectMapper());
  }

  private static Seen capture(HttpExchange exchange) throws IOException {
    return new Seen(
        exchange.getRequestMethod(),
        exchange.getRequestURI().getPath(),
        exchange.getRequestURI().getQuery(),
        exchange.getRequestHeaders().getFirst("apikey"),
        exchange.getRequestHeaders().getFirst("Prefer"),
        new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
  }

  @FunctionalInterface
  private interface ServerCall {
    void run(String baseUrl) throws Exception;
  }

  private static void withServer(HttpHandler handler, ServerCall call) throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    ExecutorService threads = Executors.newCachedThreadPool(task -> {
      Thread thread = new Thread(task, "supabase-rest-test");
      thread.setDaemon(true);
      return thread;
    });
    server.setExecutor(threads);
    server.createContext("/", handler);
    server.start();
    try {
      call.run("http://127.0.0.1:" + server.getAddress().getPort());
    } finally {
      server.stop(0);
      threads.shutdownNow();
    }
  }

  private static void respond(HttpExchange exchange, int status, String body) throws IOException {
    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
    if (bytes.length > 0) {
      exchange.getResponseBody().write(bytes);
    }
    exchange.close();
  }
}
