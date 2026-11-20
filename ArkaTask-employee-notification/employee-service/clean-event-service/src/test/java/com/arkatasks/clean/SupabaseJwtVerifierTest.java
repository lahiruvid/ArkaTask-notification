package com.arkatasks.clean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Date;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Test-only keys and a local JWKS stub. Production never signs tokens. */
class SupabaseJwtVerifierTest {
  static final String URL = "https://testref.supabase.co";
  static final String ISS = URL + "/auth/v1";

  static KeyPair rsa() throws Exception {
    KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
    g.initialize(2048);
    return g.generateKeyPair();
  }

  static KeyPair ec() throws Exception {
    KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
    g.initialize(256);
    return g.generateKeyPair();
  }

  static String b64(BigInteger v) {
    byte[] bytes = v.toByteArray();
    if (bytes.length > 1 && bytes[0] == 0) bytes = java.util.Arrays.copyOfRange(bytes, 1, bytes.length);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  static String rsaJwk(String kid, KeyPair pair) {
    RSAPublicKey pub = (RSAPublicKey) pair.getPublic();
    return "{\"kty\":\"RSA\",\"kid\":\"" + kid + "\",\"alg\":\"RS256\",\"use\":\"sig\",\"key_ops\":[\"verify\"],\"ext\":true,"
        + "\"n\":\"" + b64(pub.getModulus()) + "\",\"e\":\"" + b64(pub.getPublicExponent()) + "\"}";
  }

  static String ecJwk(String kid, KeyPair pair) {
    ECPublicKey pub = (ECPublicKey) pair.getPublic();
    return "{\"kty\":\"EC\",\"kid\":\"" + kid + "\",\"alg\":\"ES256\",\"crv\":\"P-256\",\"use\":\"sig\","
        + "\"x\":\"" + b64(pub.getW().getAffineX()) + "\",\"y\":\"" + b64(pub.getW().getAffineY()) + "\"}";
  }

  static String jwks(String... jwk) {
    return "{\"keys\":[" + String.join(",", jwk) + "]}";
  }

  static String token(PrivateKey key, String kid, String iss, String aud, Instant exp, String role) {
    var b = Jwts.builder().header().keyId(kid).and()
        .subject("1b1c1d1e-0000-4000-8000-000000000001")
        .issuer(iss)
        .audience().add(aud).and()
        .issuedAt(Date.from(Instant.now()))
        .claim("role", role)
        .claim("is_anonymous", true);
    if (exp != null) b.expiration(Date.from(exp));
    return b.signWith(key).compact();
  }

  KeyPair main;
  AtomicReference<String> served;
  AtomicInteger fetches;
  MutableClock clock;
  SupabaseJwks cache;
  SupabaseJwtVerifier verifier;

  static final class MutableClock extends Clock {
    Instant now = Instant.parse("2026-11-20T00:00:00Z");
    @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
    @Override public Clock withZone(java.time.ZoneId zone) { return this; }
    @Override public Instant instant() { return now; }
  }

  @BeforeEach
  void setUp() throws Exception {
    main = rsa();
    served = new AtomicReference<>(jwks(rsaJwk("kid-1", main)));
    fetches = new AtomicInteger();
    clock = new MutableClock();
    cache = new SupabaseJwks(java.net.URI.create(ISS + "/.well-known/jwks.json"), uri -> {
      fetches.incrementAndGet();
      return served.get();
    }, new ObjectMapper(), Duration.ofSeconds(60), clock);
    cache.loadAtStartup(1, Duration.ZERO, Duration.ofSeconds(30));
    verifier = new SupabaseJwtVerifier(cache, ISS, "authenticated", Set.of("RS256", "ES256"), 30);
  }

  int status(String header) {
    return assertThrows(SupabaseJwtVerifier.AuthException.class, () -> verifier.verify(header)).status();
  }

  String valid() {
    return token(main.getPrivate(), "kid-1", ISS, "authenticated", Instant.now().plusSeconds(3600), "authenticated");
  }

  @Test
  void validTokenPasses() {
    var claims = verifier.verify("Bearer " + valid());
    assertEquals("1b1c1d1e-0000-4000-8000-000000000001", claims.getSubject());
    assertEquals(1, fetches.get(), "JWKS fetched once at startup only");
  }

  @Test
  void lowercaseBearerSchemeAccepted() {
    verifier.verify("bearer " + valid());
  }

  @Test
  void expiredTokenRejected() {
    assertEquals(401, status("Bearer " + token(main.getPrivate(), "kid-1", ISS, "authenticated",
        Instant.now().minusSeconds(120), "authenticated")));
  }

  @Test
  void clockSkewToleratesRecentExpiry() {
    verifier.verify("Bearer " + token(main.getPrivate(), "kid-1", ISS, "authenticated",
        Instant.now().minusSeconds(5), "authenticated"));
  }

  @Test
  void missingExpRejected() {
    assertEquals(401, status("Bearer " + token(main.getPrivate(), "kid-1", ISS, "authenticated", null, "authenticated")));
  }

  @Test
  void futureNbfRejected() {
    String t = Jwts.builder().header().keyId("kid-1").and()
        .subject("u1").issuer(ISS).audience().add("authenticated").and()
        .claim("role", "authenticated")
        .notBefore(Date.from(Instant.now().plusSeconds(600)))
        .expiration(Date.from(Instant.now().plusSeconds(3600)))
        .signWith(main.getPrivate()).compact();
    assertEquals(401, status("Bearer " + t));
  }

  @Test
  void wrongSignatureRejected() throws Exception {
    KeyPair other = rsa();
    assertEquals(401, status("Bearer " + token(other.getPrivate(), "kid-1", ISS, "authenticated",
        Instant.now().plusSeconds(3600), "authenticated")));
  }

  @Test
  void tamperedPayloadRejected() {
    String[] parts = valid().split("\\.");
    String payload = new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8)
        .replace("1b1c1d1e", "ffffffff");
    String forged = parts[0] + "." + Base64.getUrlEncoder().withoutPadding()
        .encodeToString(payload.getBytes(StandardCharsets.UTF_8)) + "." + parts[2];
    assertEquals(401, status("Bearer " + forged));
  }

  @Test
  void wrongIssuerRejected() {
    assertEquals(401, status("Bearer " + token(main.getPrivate(), "kid-1", "https://evil.supabase.co/auth/v1",
        "authenticated", Instant.now().plusSeconds(3600), "authenticated")));
  }

  @Test
  void wrongAudienceRejected() {
    assertEquals(401, status("Bearer " + token(main.getPrivate(), "kid-1", ISS, "anon",
        Instant.now().plusSeconds(3600), "authenticated")));
  }

  @Test
  void nonAuthenticatedRoleRejected() {
    assertEquals(401, status("Bearer " + token(main.getPrivate(), "kid-1", ISS, "authenticated",
        Instant.now().plusSeconds(3600), "service_role")));
  }

  @Test
  void missingOrMalformedHeaderRejected() {
    assertEquals(401, status(null));
    assertEquals(401, status(""));
    assertEquals(401, status("Bearer"));
    assertEquals(401, status("Bearer "));
    assertEquals(401, status("Basic abc"));
    assertEquals(401, status("Bearer not-a-jwt"));
    assertEquals(401, status("Bearer a.b.c"));
  }

  @Test
  void algNoneRejected() {
    String header = Base64.getUrlEncoder().withoutPadding()
        .encodeToString("{\"alg\":\"none\",\"kid\":\"kid-1\"}".getBytes(StandardCharsets.UTF_8));
    String body = Base64.getUrlEncoder().withoutPadding().encodeToString(
        ("{\"sub\":\"u1\",\"iss\":\"" + ISS + "\",\"aud\":\"authenticated\",\"role\":\"authenticated\",\"exp\":"
            + (Instant.now().getEpochSecond() + 3600) + "}").getBytes(StandardCharsets.UTF_8));
    assertEquals(401, status("Bearer " + header + "." + body + "."));
  }

  @Test
  void hmacTokenRejectedEvenWithKnownKid() {
    String t = Jwts.builder().header().keyId("kid-1").and()
        .subject("u1").issuer(ISS).audience().add("authenticated").and()
        .claim("role", "authenticated").expiration(Date.from(Instant.now().plusSeconds(3600)))
        .signWith(Keys.hmacShaKeyFor(new byte[32]), Jwts.SIG.HS256).compact();
    assertEquals(401, status("Bearer " + t));
  }

  @Test
  void hmacAlgorithmCannotBeConfigured() {
    assertThrows(IllegalArgumentException.class,
        () -> new SupabaseJwtVerifier(cache, ISS, "authenticated", Set.of("HS256"), 30));
  }

  @Test
  void rs256OnlyConfigRejectsEs256() throws Exception {
    KeyPair e = ec();
    served.set(jwks(rsaJwk("kid-1", main), ecJwk("kid-ec", e)));
    assertTrue(cache.refresh(true));
    var strict = new SupabaseJwtVerifier(cache, ISS, "authenticated", Set.of("RS256"), 30);
    String t = token(e.getPrivate(), "kid-ec", ISS, "authenticated", Instant.now().plusSeconds(3600), "authenticated");
    assertThrows(SupabaseJwtVerifier.AuthException.class, () -> strict.verify("Bearer " + t));
    verifier.verify("Bearer " + t);
  }

  @Test
  void unknownKidRefetchesOnceThenRateLimits() throws Exception {
    KeyPair rotated = rsa();
    served.set(jwks(rsaJwk("kid-1", main), rsaJwk("kid-2", rotated)));
    clock.now = clock.now.plusSeconds(61);
    String t2 = token(rotated.getPrivate(), "kid-2", ISS, "authenticated", Instant.now().plusSeconds(3600), "authenticated");
    verifier.verify("Bearer " + t2);
    assertEquals(2, fetches.get());
    // Another unknown kid inside the 60 s window must not hit the JWKS URL again.
    String t3 = token(rsa().getPrivate(), "kid-3", ISS, "authenticated", Instant.now().plusSeconds(3600), "authenticated");
    assertEquals(401, status("Bearer " + t3));
    assertEquals(2, fetches.get());
    clock.now = clock.now.plusSeconds(61);
    assertEquals(401, status("Bearer " + t3));
    assertEquals(3, fetches.get());
  }

  @Test
  void removedKeyStopsWorkingAfterRefresh() throws Exception {
    KeyPair rotated = rsa();
    String old = valid();
    verifier.verify("Bearer " + old);
    served.set(jwks(rsaJwk("kid-2", rotated)));
    assertTrue(cache.refresh(true));
    assertEquals(401, status("Bearer " + old));
  }

  @Test
  void failedRefreshKeepsLastGoodKeys() {
    served.set("not json");
    assertFalse(cache.refresh(true));
    verifier.verify("Bearer " + valid());
  }

  @Test
  void jwksNotLoadedAnswers503() {
    var down = new SupabaseJwks(java.net.URI.create(ISS + "/.well-known/jwks.json"), uri -> {
      throw new java.io.IOException("unreachable");
    }, new ObjectMapper(), Duration.ofSeconds(60), clock);
    down.loadAtStartup(1, Duration.ZERO, Duration.ofHours(1));
    assertFalse(down.isLoaded());
    var v = new SupabaseJwtVerifier(down, ISS, "authenticated", Set.of("RS256"), 30);
    assertEquals(503, assertThrows(SupabaseJwtVerifier.AuthException.class, () -> v.verify("Bearer " + valid())).status());
  }

  @Test
  void pinnedProjectRefusesAnyOtherProject() {
    var pinned = new SupabaseJwtVerifier(cache, ISS, "authenticated", Set.of("RS256"), 30, true);
    pinned.adoptProject(URL + "/");
    assertEquals(400, assertThrows(SupabaseJwtVerifier.AuthException.class,
        () -> pinned.adoptProject("https://other.supabase.co")).status());
    assertEquals(400, assertThrows(SupabaseJwtVerifier.AuthException.class,
        () -> pinned.adoptProject("https://evil.example.com")).status());
    pinned.verify("Bearer " + valid());
  }

  @Test
  void notConfiguredAnswers503() {
    var v = new SupabaseJwtVerifier(null, "", "authenticated", Set.of("RS256"), 30);
    assertEquals(503, assertThrows(SupabaseJwtVerifier.AuthException.class, () -> v.verify("Bearer " + valid())).status());
  }

  @Test
  void errorMessagesNeverContainTheToken() {
    String t = token(main.getPrivate(), "kid-1", ISS, "anon", Instant.now().plusSeconds(3600), "authenticated");
    var ex = assertThrows(SupabaseJwtVerifier.AuthException.class, () -> verifier.verify("Bearer " + t));
    assertFalse(ex.getMessage().contains(t.substring(0, 20)));
  }
}
