package com.arkatasks.clean;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwsHeader;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.LocatorAdapter;
import io.jsonwebtoken.security.SecurityException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.security.Key;
import java.time.Clock;
import java.time.Duration;
import java.util.Date;
import java.util.Set;

/**
 * Verifies Supabase Auth access tokens offline: signature against the cached JWKS key
 * (kid lookup, alg pinned to the allowed asymmetric list and to the key type),
 * exp required, nbf honoured, iss and aud exact, small clock skew, role authenticated.
 * Unsigned (alg=none) and HMAC tokens are always rejected.
 */
public class SupabaseJwtVerifier {
  /** Why a token was refused. status is 401 or 503. The message never contains the token. */
  public static final class AuthException extends RuntimeException {
    private final int status;

    public AuthException(int status, String message) {
      super(message);
      this.status = status;
    }

    public int status() {
      return status;
    }
  }

  private volatile SupabaseJwks jwks;
  private volatile String issuer;
  private final boolean pinned;
  private final String audience;
  private final Set<String> allowedAlgs;
  private final long clockSkewSeconds;

  public SupabaseJwtVerifier(
      SupabaseJwks jwks, String issuer, String audience, Set<String> allowedAlgs, long clockSkewSeconds) {
    this(jwks, issuer, audience, allowedAlgs, clockSkewSeconds, false);
  }

  /** @param pinned true when SUPABASE_URL fixed the project: no other project can ever be adopted. */
  public SupabaseJwtVerifier(
      SupabaseJwks jwks, String issuer, String audience, Set<String> allowedAlgs, long clockSkewSeconds,
      boolean pinned) {
    this.jwks = jwks;
    this.issuer = issuer;
    this.pinned = pinned;
    this.audience = audience;
    this.allowedAlgs = Set.copyOf(allowedAlgs);
    this.clockSkewSeconds = clockSkewSeconds;
    for (String alg : this.allowedAlgs) {
      if (!alg.startsWith("RS") && !alg.startsWith("ES") && !alg.startsWith("PS")) {
        throw new IllegalArgumentException("Only asymmetric algorithms are allowed, not " + alg);
      }
    }
  }

  public boolean ready() {
    SupabaseJwks current = jwks;
    return current != null && current.isLoaded();
  }

  /**
   * Loads JWKS from https://&lt;project&gt;.supabase.co/auth/v1/.well-known/jwks.json. The URL must be
   * that host; a client-supplied JWKS URL is never used. When the server config pinned a project,
   * any other project is refused. The anon key is not involved.
   */
  public synchronized void adoptProject(String projectUrl) {
    String base;
    try {
      base = SupabaseKeysFile.requireProjectUrl(projectUrl);
    } catch (SupabaseKeysFile.RejectedKeys ex) {
      throw new AuthException(400, ex.getMessage());
    }
    String iss = base + "/auth/v1";
    if (iss.equals(issuer) && jwks != null) {
      return;
    }
    if (pinned) {
      throw new AuthException(400, "Supabase project URL does not match this server.");
    }
    SupabaseJwks previous = jwks;
    SupabaseJwks cache = new SupabaseJwks(
        URI.create(iss + "/.well-known/jwks.json"),
        SupabaseJwks.httpsFetcher(),
        new ObjectMapper(),
        Duration.ofSeconds(60),
        Clock.systemUTC());
    cache.loadAtStartup(2, Duration.ofSeconds(1), Duration.ofSeconds(30));
    this.jwks = cache;
    this.issuer = iss;
    if (previous != null) {
      previous.close();
    }
  }

  /** @param authorization the raw Authorization header value */
  public Claims verify(String authorization) {
    if (jwks == null) {
      throw new AuthException(503, "Supabase auth is not configured on the server.");
    }
    if (authorization == null || authorization.isBlank()) {
      throw new AuthException(401, "Employee login is required.");
    }
    String value = authorization.trim();
    if (value.length() < 8 || !value.regionMatches(true, 0, "Bearer ", 0, 7)) {
      throw new AuthException(401, "Employee login is required.");
    }
    String token = value.substring(7).trim();
    if (token.isEmpty() || token.chars().filter(c -> c == '.').count() != 2) {
      throw new AuthException(401, "Employee login is required.");
    }
    if (!jwks.isLoaded()) {
      throw new AuthException(503, "Sign-in keys are not loaded yet. Try again in a minute.");
    }
    Claims claims;
    try {
      claims = Jwts.parser()
          .keyLocator(new LocatorAdapter<Key>() {
            @Override
            protected Key locate(JwsHeader header) {
              String alg = header.getAlgorithm();
              if (alg == null || !allowedAlgs.contains(alg)) {
                throw new SecurityException("Token algorithm is not allowed.");
              }
              SupabaseJwks.VerificationKey found = jwks.find(header.getKeyId());
              if (found == null) {
                throw new SecurityException("Token key id is unknown.");
              }
              boolean typeMatches = "RSA".equals(found.kty())
                  ? (alg.startsWith("RS") || alg.startsWith("PS"))
                  : "ES256".equals(alg);
              if (!alg.equals(found.alg()) || !typeMatches) {
                throw new SecurityException("Token algorithm does not match its key.");
              }
              return found.key();
            }
          })
          .requireIssuer(issuer)
          .requireAudience(audience)
          .clockSkewSeconds(clockSkewSeconds)
          .build()
          .parseSignedClaims(token)
          .getPayload();
    } catch (RuntimeException ex) {
      // Covers bad signature, expired, not-yet-valid, wrong iss/aud, alg=none, malformed.
      throw new AuthException(401, "Employee login is required.");
    }
    Date exp = claims.getExpiration();
    if (exp == null) {
      throw new AuthException(401, "Employee login is required.");
    }
    String sub = claims.getSubject();
    if (sub == null || sub.isBlank()) {
      throw new AuthException(401, "Employee login is required.");
    }
    Object role = claims.get("role");
    if (!"authenticated".equals(role)) {
      throw new AuthException(401, "Employee login is required.");
    }
    return claims;
  }
}
