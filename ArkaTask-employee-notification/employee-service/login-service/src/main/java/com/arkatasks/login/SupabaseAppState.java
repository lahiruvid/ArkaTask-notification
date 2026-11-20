package com.arkatasks.login;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Reads the live app_state document from Supabase REST.
 * Uses only the public anon key. Service-role and secret keys are refused and never logged.
 */
@Component
public class SupabaseAppState {
  /** Supabase did not return a usable app_state row. The message is safe to show a client. */
  public static final class Unavailable extends RuntimeException {
    public Unavailable() {
      super("Could not read employees from Supabase.");
    }
  }

  private final HttpClient http;
  private final ObjectMapper json;

  @Autowired
  public SupabaseAppState(ObjectMapper json) {
    this(HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build(), json);
  }

  SupabaseAppState(HttpClient http, ObjectMapper json) {
    this.http = http;
    this.json = json;
  }

  /**
   * Payload of the app_state row id=main, or null when that row is absent.
   * The anon key is sent as apikey (and as Authorization when it is a JWT) and is not written to logs.
   */
  public JsonNode fetch(String supabaseUrl, String anonKey) {
    SupabaseKeysFile.requirePublicKey(anonKey);
    String base = SupabaseKeysFile.normalizeUrl(supabaseUrl);
    URI uri = URI.create(base + "/rest/v1/app_state?id=eq.main&select=payload");
    HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(10))
        .header("Accept", "application/json")
        .GET();
    SupabaseKeysFile.authHeaders(anonKey).forEach(builder::header);
    HttpRequest request = builder.build();
    HttpResponse<String> response;
    try {
      response = http.send(request, HttpResponse.BodyHandlers.ofString());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw new Unavailable();
    } catch (IOException ex) {
      throw new Unavailable();
    }
    if (response.statusCode() != 200) {
      throw new Unavailable();
    }
    return payloadOf(response.body());
  }

  private JsonNode payloadOf(String body) {
    try {
      if (body == null || body.isBlank()) return null;
      JsonNode root = json.readTree(body);
      if (root == null || root.isNull()) return null;
      if (root.isArray()) {
        if (root.isEmpty()) return null;
        root = root.get(0);
      }
      if (root == null || root.isNull() || !root.isObject()) return null;
      JsonNode payload = root.get("payload");
      if (payload == null || payload.isNull() || payload.isMissingNode()) return null;
      if (payload.isTextual()) {
        String text = payload.asText();
        if (text.isBlank()) return null;
        return json.readTree(text);
      }
      return payload.isObject() ? payload : null;
    } catch (IOException ex) {
      throw new Unavailable();
    }
  }
}
