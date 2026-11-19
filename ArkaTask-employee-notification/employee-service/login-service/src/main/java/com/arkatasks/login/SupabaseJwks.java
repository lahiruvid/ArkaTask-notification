package com.arkatasks.login;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigInteger;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Supabase Auth public keys, fetched from the project's JWKS URL and cached in memory only.
 * Nothing is written to disk. Verification is offline against this cache.
 * An unknown kid triggers one rate-limited refetch (key rotation).
 */
public class SupabaseJwks {
  /** One verification key from the JWKS. */
  public record VerificationKey(String kid, String kty, String alg, PublicKey key) {}

  /** Fetches the raw JWKS JSON. Swappable in tests. */
  public interface Fetcher {
    String fetch(URI uri) throws Exception;
  }

  private static final Logger log = LoggerFactory.getLogger(SupabaseJwks.class);

  private final URI jwksUri;
  private final Fetcher fetcher;
  private final ObjectMapper json;
  private final Duration minRefresh;
  private final Clock clock;
  private volatile Map<String, VerificationKey> keys = Map.of();
  private volatile Instant lastFetchAttempt = Instant.EPOCH;
  private volatile Instant lastSuccess = Instant.EPOCH;
  private ScheduledExecutorService retrier;

  public SupabaseJwks(URI jwksUri, Fetcher fetcher, ObjectMapper json, Duration minRefresh, Clock clock) {
    this.jwksUri = jwksUri;
    this.fetcher = fetcher;
    this.json = json;
    this.minRefresh = minRefresh;
    this.clock = clock;
  }

  /** Production fetcher: HTTPS only, short timeouts, no redirects. */
  public static Fetcher httpsFetcher() {
    HttpClient client = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build();
    return uri -> {
      if (!"https".equalsIgnoreCase(uri.getScheme())) {
        throw new IllegalStateException("JWKS URL must use https.");
      }
      HttpResponse<String> res = client.send(
          HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(10)).GET().build(),
          HttpResponse.BodyHandlers.ofString());
      if (res.statusCode() != 200) {
        throw new IllegalStateException("JWKS returned HTTP " + res.statusCode());
      }
      return res.body();
    };
  }

  /**
   * Startup load. Tries a few times. If Supabase is still unreachable the service keeps
   * running (health stays up, protected endpoints answer 503) and a background retry
   * loads the keys as soon as the JWKS URL answers. Once loaded, the same background
   * thread re-reads the JWKS every maxAge so a revoked key stops being trusted.
   */
  public void loadAtStartup(int attempts, Duration pause, Duration backgroundRetry) {
    loadAtStartup(attempts, pause, backgroundRetry, Duration.ofHours(12));
  }

  public void loadAtStartup(int attempts, Duration pause, Duration backgroundRetry, Duration maxAge) {
    boolean loaded = false;
    for (int i = 1; i <= attempts && !loaded; i++) {
      loaded = refresh(true);
      if (!loaded && i < attempts) sleep(pause);
    }
    if (!loaded) {
      log.error("Supabase JWKS could not be loaded from {} at startup. Token checks answer 503 "
          + "until it loads. Retrying every {} seconds.", jwksUri, backgroundRetry.toSeconds());
    }
    retrier = Executors.newSingleThreadScheduledExecutor(r -> {
      Thread t = new Thread(r, "supabase-jwks-refresh");
      t.setDaemon(true);
      return t;
    });
    retrier.scheduleWithFixedDelay(() -> {
      try {
        if (!isLoaded() || clock.instant().isAfter(lastSuccess.plus(maxAge))) {
          refresh(true);
        }
      } catch (RuntimeException ex) {
        log.warn("Supabase JWKS background refresh failed: {}", ex.getMessage());
      }
    }, backgroundRetry.toMillis(), backgroundRetry.toMillis(), TimeUnit.MILLISECONDS);
  }

  public boolean isLoaded() {
    return !keys.isEmpty();
  }

  /** Key for this kid. On a miss, refetches at most once per minRefresh. */
  public VerificationKey find(String kid) {
    if (kid == null || kid.isBlank()) return null;
    VerificationKey hit = keys.get(kid);
    if (hit != null) return hit;
    if (refresh(false)) return keys.get(kid);
    return null;
  }

  /** @return true when a non-empty key set is now cached */
  synchronized boolean refresh(boolean force) {
    Instant now = clock.instant();
    if (!force && now.isBefore(lastFetchAttempt.plus(minRefresh))) {
      return false;
    }
    lastFetchAttempt = now;
    try {
      Map<String, VerificationKey> parsed = parse(fetcher.fetch(jwksUri));
      if (parsed.isEmpty()) {
        log.warn("Supabase JWKS at {} has no usable RSA or EC signing keys. "
            + "Enable asymmetric JWT signing keys in the Supabase dashboard.", jwksUri);
        return false;
      }
      keys = Collections.unmodifiableMap(parsed);
      lastSuccess = now;
      log.info("Loaded {} Supabase JWKS key(s) from {}: {}", parsed.size(), jwksUri, parsed.keySet());
      return true;
    } catch (Exception ex) {
      log.warn("Supabase JWKS fetch from {} failed: {}", jwksUri, ex.getMessage());
      return false;
    }
  }

  Map<String, VerificationKey> parse(String body) throws Exception {
    JsonNode root = json.readTree(body == null ? "{}" : body);
    Map<String, VerificationKey> out = new HashMap<>();
    for (JsonNode jwk : root.path("keys")) {
      String kid = jwk.path("kid").asText("");
      String kty = jwk.path("kty").asText("");
      String use = jwk.path("use").asText("sig");
      if (kid.isEmpty() || !"sig".equals(use)) continue;
      try {
        if ("RSA".equals(kty)) {
          RSAPublicKeySpec spec = new RSAPublicKeySpec(uint(jwk, "n"), uint(jwk, "e"));
          PublicKey key = KeyFactory.getInstance("RSA").generatePublic(spec);
          out.put(kid, new VerificationKey(kid, kty, jwk.path("alg").asText("RS256"), key));
        } else if ("EC".equals(kty) && "P-256".equals(jwk.path("crv").asText(""))) {
          AlgorithmParameters params = AlgorithmParameters.getInstance("EC");
          params.init(new ECGenParameterSpec("secp256r1"));
          ECParameterSpec curve = params.getParameterSpec(ECParameterSpec.class);
          ECPublicKeySpec spec = new ECPublicKeySpec(new ECPoint(uint(jwk, "x"), uint(jwk, "y")), curve);
          PublicKey key = KeyFactory.getInstance("EC").generatePublic(spec);
          out.put(kid, new VerificationKey(kid, kty, jwk.path("alg").asText("ES256"), key));
        }
        // Symmetric (oct) and other key types are ignored on purpose.
      } catch (Exception ex) {
        log.warn("Skipping unreadable JWKS key {}: {}", kid, ex.getMessage());
      }
    }
    return out;
  }

  private static BigInteger uint(JsonNode jwk, String field) {
    String value = jwk.path(field).asText("");
    if (value.isEmpty()) throw new IllegalArgumentException("missing " + field);
    return new BigInteger(1, Base64.getUrlDecoder().decode(value));
  }

  private static void sleep(Duration d) {
    try {
      Thread.sleep(d.toMillis());
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
    }
  }
}
