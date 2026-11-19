package com.arkatasks.login;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

/**
 * Phone check stays on the local app_state row. This repo has no Supabase REST client;
 * the patch's copy used one, and that call is not part of the outbox path here.
 */
class LoginControllerTokenTest {
  static final String URL = "https://testref.supabase.co";
  static final String PAYLOAD = "{\"employees\":[{\"id\":\"e1\",\"name\":\"Ana\",\"phone\":\"+39 333 111 2222\"}],"
      + "\"jobs\":[]}";

  @TempDir
  Path dir;

  JdbcTemplate jdbc;
  SupabaseKeysFile keys;
  EmployeeIdentityStore identities;
  CleanEventClient cleanEvent;
  LoginController controller;

  @BeforeEach
  @SuppressWarnings("unchecked")
  void setUp() {
    jdbc = mock(JdbcTemplate.class);
    when(jdbc.query(any(String.class), any(ResultSetExtractor.class))).thenReturn(PAYLOAD);
    keys = new SupabaseKeysFile(dir.resolve("supabase-keys.json"), URL, new ObjectMapper());
    identities = mock(EmployeeIdentityStore.class);
    cleanEvent = mock(CleanEventClient.class);
    controller = new LoginController(jdbc, new ObjectMapper(), "Europe/Rome", mock(PhoneLoginLimiter.class),
        cleanEvent, keys, identities);
  }

  MockHttpServletRequest withClaims() {
    var req = new MockHttpServletRequest("POST", "/api/login");
    req.setAttribute(SupabaseAuthFilter.CLAIMS,
        Jwts.claims().subject("auth-uid-1").issuer(URL + "/auth/v1").add("role", "authenticated").build());
    return req;
  }

  Map<String, String> body(String key) {
    return Map.of("phone", "3331112222", "supabaseUrl", URL, "supabaseAnonKey", key);
  }

  @Test
  @SuppressWarnings("unchecked")
  void noVerifiedTokenMeans401AndNothingSaved() throws Exception {
    var res = controller.login(new MockHttpServletRequest(), body(SupabaseKeysFileTest.fakeJwt("anon")));
    assertEquals(401, res.getStatusCode().value());
    assertFalse(Files.exists(keys.path()));
    verify(jdbc, never()).query(any(String.class), any(ResultSetExtractor.class));
  }

  @Test
  void validTokenSavesKeysAndLinksEmployee() throws Exception {
    String anon = SupabaseKeysFileTest.fakeJwt("anon");
    var res = controller.login(withClaims(), body(anon));
    assertEquals(200, res.getStatusCode().value());
    assertEquals("e1", res.getBody().get("employeeId"));
    assertFalse(res.getBody().containsKey("token"), "the service must not mint tokens");
    assertFalse(res.getBody().toString().contains(anon), "the anon key must not be echoed");
    assertEquals(anon, keys.read().anonKey());
    assertEquals("rw-------", java.nio.file.attribute.PosixFilePermissions.toString(
        Files.getPosixFilePermissions(keys.path())));
    verify(identities).save("auth-uid-1", "e1", "Ana", "+39 333 111 2222");
    verify(cleanEvent).employeeOpened("e1", "Ana");
  }

  @Test
  void tokenFromAnotherProjectRefused() throws Exception {
    var req = new MockHttpServletRequest("POST", "/api/login");
    req.setAttribute(SupabaseAuthFilter.CLAIMS,
        Jwts.claims().subject("u").issuer("https://other.supabase.co/auth/v1").add("role", "authenticated").build());
    var res = controller.login(req, body(SupabaseKeysFileTest.fakeJwt("anon")));
    assertEquals(400, res.getStatusCode().value());
    assertFalse(Files.exists(keys.path()));
  }

  @Test
  @SuppressWarnings("unchecked")
  void serviceRoleKeyRefused() throws Exception {
    var res = controller.login(withClaims(), body(SupabaseKeysFileTest.fakeJwt("service_role")));
    assertEquals(400, res.getStatusCode().value());
    assertFalse(Files.exists(keys.path()));
    verify(jdbc, never()).query(any(String.class), any(ResultSetExtractor.class));
  }

  @Test
  @SuppressWarnings("unchecked")
  void databaseFailureDoesNotSaveKeys() {
    when(jdbc.query(any(String.class), any(ResultSetExtractor.class)))
        .thenThrow(new DataAccessResourceFailureException("db down"));
    assertThrows(DataAccessResourceFailureException.class,
        () -> controller.login(withClaims(), body(SupabaseKeysFileTest.fakeJwt("anon"))));
    assertNull(keys.read());
  }

  @Test
  void unknownPhoneIs404AndNoIdentity() {
    String anon = SupabaseKeysFileTest.fakeJwt("anon");
    var ex = assertThrows(ResponseStatusException.class,
        () -> controller.login(withClaims(), Map.of("phone", "999", "supabaseUrl", URL, "supabaseAnonKey", anon)));
    assertEquals(404, ex.getStatusCode().value());
    verify(identities, never()).save(any(), any(), any(), any());
    assertTrue(Files.exists(keys.path()), "keys are saved once the token was valid and the database read succeeded");
  }
}
