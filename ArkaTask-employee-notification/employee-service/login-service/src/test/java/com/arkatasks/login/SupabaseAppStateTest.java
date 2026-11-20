package com.arkatasks.login;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** Supabase REST lookup against a local HTTP server. No real project is contacted. */
class SupabaseAppStateTest {
  @Test
  void readsAppStateWithTheAnonKeyOnly() throws Exception {
    String anon = SupabaseKeysFileTest.fakeJwt("anon");
    String payload = "{\"employees\":[{\"id\":\"e1\",\"name\":\"Ana\",\"phone\":\"+39 333\"}],\"jobs\":[]}";
    AtomicReference<String> method = new AtomicReference<>();
    AtomicReference<String> path = new AtomicReference<>();
    AtomicReference<String> query = new AtomicReference<>();
    AtomicReference<String> apiKey = new AtomicReference<>();
    AtomicReference<String> authorization = new AtomicReference<>();
    withServer("/rest/v1/app_state", exchange -> {
      method.set(exchange.getRequestMethod());
      path.set(exchange.getRequestURI().getPath());
      query.set(exchange.getRequestURI().getRawQuery());
      apiKey.set(exchange.getRequestHeaders().getFirst("apikey"));
      authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
      respond(exchange, 200, "[{\"payload\":" + payload + "}]");
    }, base -> {
      JsonNode root = client().fetch(base, anon);
      assertEquals("GET", method.get());
      assertEquals("/rest/v1/app_state", path.get());
      assertTrue(query.get().contains("id=eq.main"));
      assertTrue(query.get().contains("select=payload"));
      assertEquals(anon, apiKey.get());
      assertEquals("Bearer " + anon, authorization.get());
      assertEquals("e1", root.path("employees").get(0).path("id").asText());
      assertEquals("Ana", root.path("employees").get(0).path("name").asText());
    });
  }

  @Test
  void acceptsPayloadStoredAsJsonText() throws Exception {
    String anon = SupabaseKeysFileTest.fakeJwt("anon");
    withServer("/rest/v1/app_state", exchange -> respond(exchange, 200,
        "[{\"payload\":\"{\\\"employees\\\":[{\\\"id\\\":\\\"e9\\\"}]}\"}]"), base -> {
      JsonNode root = client().fetch(base, anon);
      assertEquals("e9", root.path("employees").get(0).path("id").asText());
    });
  }

  @Test
  void missingRowIsNull() throws Exception {
    String anon = SupabaseKeysFileTest.fakeJwt("anon");
    withServer("/rest/v1/app_state", exchange -> respond(exchange, 200, "[]"), base ->
        assertNull(client().fetch(base, anon)));
  }

  @Test
  void httpErrorDoesNotReturnAPayload() throws Exception {
    String anon = SupabaseKeysFileTest.fakeJwt("anon");
    withServer("/rest/v1/app_state", exchange ->
        respond(exchange, 401, "{\"employees\":[{\"id\":\"e1\"}]}"), base ->
        assertThrows(SupabaseAppState.Unavailable.class, () -> client().fetch(base, anon)));
  }

  @Test
  void serviceRoleAndSecretKeysAreNeverSent() throws Exception {
    withServer("/", exchange -> {
      throw new AssertionError("a non-anon key must not be sent to Supabase");
    }, base -> {
      SupabaseAppState appState = client();
      assertThrows(SupabaseKeysFile.RejectedKeys.class,
          () -> appState.fetch(base, SupabaseKeysFileTest.fakeJwt("service_role")));
      assertThrows(SupabaseKeysFile.RejectedKeys.class,
          () -> appState.fetch(base, "sb_secret_not_a_real_key"));
    });
  }

  private static SupabaseAppState client() {
    return new SupabaseAppState(
        HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build(),
        new ObjectMapper());
  }

  @FunctionalInterface
  private interface ServerCall {
    void run(String baseUrl) throws Exception;
  }

  private static void withServer(String path, HttpHandler handler, ServerCall call) throws Exception {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    ExecutorService threads = Executors.newCachedThreadPool(task -> {
      Thread thread = new Thread(task, "supabase-app-state-test");
      thread.setDaemon(true);
      return thread;
    });
    server.setExecutor(threads);
    server.createContext(path, handler);
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
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }
}
