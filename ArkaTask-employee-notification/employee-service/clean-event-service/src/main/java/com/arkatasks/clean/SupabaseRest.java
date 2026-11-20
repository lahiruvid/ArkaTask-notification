package com.arkatasks.clean;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Supabase REST (PostgREST) calls for clean-event-service: the app_state document and the
 * clean_outbox table. Only the public anon or publishable key is used; it is never logged.
 */
@Component
public class SupabaseRest {
  /** Supabase did not answer as expected. The message carries no key and no row data. */
  public static final class Unavailable extends RuntimeException {
    public Unavailable(String message) {
      super(message);
    }
  }

  static final String OUTBOX_COLUMNS =
      "apartment_id,date,employee_id,employee_name,employee_phone,apartment_name,clean_time";

  private final HttpClient http;
  private final ObjectMapper json;

  @Autowired
  public SupabaseRest(ObjectMapper json) {
    this(HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build(), json);
  }

  SupabaseRest(HttpClient http, ObjectMapper json) {
    this.http = http;
    this.json = json;
  }

  /** place_name of this employee's job at the apartment on that date, else the apartment id. */
  public String apartmentName(SupabaseKeysFile.Creds creds, String apartmentId, String date, String employeeId) {
    JsonNode rows = get(creds, "app_state?id=eq.main&select=payload");
    JsonNode payload = rows.isArray() ? rows.path(0).path("payload") : rows.path("payload");
    if (payload.isTextual()) {
      payload = readTree(payload.asText());
    }
    for (JsonNode job : payload.path("jobs")) {
      if (!apartmentId.equals(job.path("property_id").asText())) continue;
      if (!date.equals(job.path("date").asText())) continue;
      for (JsonNode assignment : job.path("job_assignments")) {
        if (employeeId.equals(assignment.path("employee_id").asText())) {
          String name = job.path("place_name").asText("").trim();
          return name.isEmpty() ? apartmentId : name;
        }
      }
    }
    return apartmentId;
  }

  /** True when this employee already recorded this apartment on this date. */
  public boolean outboxHas(SupabaseKeysFile.Creds creds, String apartmentId, String date, String employeeId) {
    JsonNode rows = get(creds, "clean_outbox?select=apartment_id"
        + keyFilter(apartmentId, date, employeeId) + "&limit=1");
    return rows.isArray() && !rows.isEmpty();
  }

  /** Inserts a PENDING row. A row with the same apartment, date, and employee is left as it is. */
  public void insertOutbox(SupabaseKeysFile.Creds creds, CleanEvent event) {
    ObjectNode row = json.createObjectNode();
    row.put("apartment_id", event.apartmentId());
    row.put("date", event.date());
    row.put("employee_id", event.employeeId());
    row.put("employee_name", nullToEmpty(event.employeeName()));
    row.put("employee_phone", nullToEmpty(event.employeePhone()));
    row.put("apartment_name", nullToEmpty(event.apartmentName()));
    row.put("clean_time", nullToEmpty(event.time()));
    row.put("status", "PENDING");
    HttpResponse<String> res = call(creds, "POST",
        "clean_outbox?on_conflict=apartment_id,date,employee_id",
        row.toString(), "resolution=ignore-duplicates,return=minimal");
    requireSuccess(res, "insert into clean_outbox");
  }

  /** Oldest PENDING rows first. */
  public List<CleanEvent> pendingOutbox(SupabaseKeysFile.Creds creds, int limit) {
    JsonNode rows = get(creds, "clean_outbox?select=" + OUTBOX_COLUMNS
        + "&status=eq.PENDING&order=created_at.asc&limit=" + limit);
    List<CleanEvent> out = new ArrayList<>();
    for (JsonNode row : rows) {
      out.add(new CleanEvent(
          row.path("apartment_id").asText(""),
          row.path("apartment_name").asText(""),
          row.path("date").asText(""),
          row.path("clean_time").asText(""),
          row.path("employee_id").asText(""),
          row.path("employee_name").asText(""),
          row.path("employee_phone").asText("")));
    }
    return out;
  }

  /** PENDING to RELAYED. Fails when no row changed, for example when RLS blocks the update. */
  public void markRelayed(SupabaseKeysFile.Creds creds, CleanEvent event) {
    ObjectNode change = json.createObjectNode();
    change.put("status", "RELAYED");
    change.put("relayed_at", Instant.now().toString());
    HttpResponse<String> res = call(creds, "PATCH",
        "clean_outbox?select=apartment_id&status=eq.PENDING"
            + keyFilter(event.apartmentId(), event.date(), event.employeeId()),
        change.toString(), "return=representation");
    requireSuccess(res, "update clean_outbox");
    JsonNode updated = readTree(res.body());
    if (!updated.isArray() || updated.isEmpty()) {
      throw new Unavailable("update clean_outbox changed no row. Check the RLS policies in supabase/schema.sql.");
    }
  }

  private JsonNode get(SupabaseKeysFile.Creds creds, String pathAndQuery) {
    HttpResponse<String> res = call(creds, "GET", pathAndQuery, null, null);
    if (res.statusCode() != 200) {
      throw new Unavailable("Supabase GET " + table(pathAndQuery) + " returned HTTP " + res.statusCode());
    }
    return readTree(res.body());
  }

  private HttpResponse<String> call(
      SupabaseKeysFile.Creds creds, String method, String pathAndQuery, String body, String prefer) {
    SupabaseKeysFile.requirePublicKey(creds.anonKey());
    URI uri = URI.create(SupabaseKeysFile.normalizeUrl(creds.url()) + "/rest/v1/" + pathAndQuery);
    HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(10))
        .header("Accept", "application/json");
    SupabaseKeysFile.authHeaders(creds.anonKey()).forEach(builder::header);
    if (prefer != null) {
      builder.header("Prefer", prefer);
    }
    if (body == null) {
      builder.method(method, HttpRequest.BodyPublishers.noBody());
    } else {
      builder.header("Content-Type", "application/json")
          .method(method, HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
    }
    try {
      return http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw new Unavailable("Supabase call was interrupted");
    } catch (IOException ex) {
      throw new Unavailable("Supabase is unreachable: " + ex.getClass().getSimpleName());
    }
  }

  private static void requireSuccess(HttpResponse<String> res, String what) {
    int status = res.statusCode();
    if (status < 200 || status >= 300) {
      throw new Unavailable("Supabase " + what + " returned HTTP " + status);
    }
  }

  private JsonNode readTree(String body) {
    try {
      return json.readTree(body == null || body.isBlank() ? "null" : body);
    } catch (IOException ex) {
      throw new Unavailable("Supabase returned a body that is not JSON");
    }
  }

  static String keyFilter(String apartmentId, String date, String employeeId) {
    return "&apartment_id=eq." + encode(apartmentId)
        + "&date=eq." + encode(date)
        + "&employee_id=eq." + encode(employeeId);
  }

  private static String encode(String value) {
    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
  }

  private static String table(String pathAndQuery) {
    int q = pathAndQuery.indexOf('?');
    return q < 0 ? pathAndQuery : pathAndQuery.substring(0, q);
  }

  private static String nullToEmpty(String value) {
    return value == null ? "" : value;
  }
}
