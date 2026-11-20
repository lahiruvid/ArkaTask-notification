package com.arkatasks.login;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
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
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

/**
 * Phone check reads Supabase app_state through SupabaseAppState. The HTTP call itself is covered
 * by SupabaseAppStateTest; here the client is mocked so login rules stay local.
 */
class LoginControllerTokenTest {
  static final String URL = "https://testref.supabase.co";
  static final String PAYLOAD = "{\"employees\":[{\"id\":\"e1\",\"name\":\"Ana\",\"phone\":\"+39 333 111 2222\"}],"
      + "\"jobs\":[]}";

  @TempDir
  Path dir;

  ObjectMapper json;
  SupabaseAppState appState;
  SupabaseKeysFile keys;
  EmployeeIdentityStore identities;
  CleanEventClient cleanEvent;
  LoginController controller;

  @BeforeEach
  void setUp() throws Exception {
    json = new ObjectMapper();
    appState = mock(SupabaseAppState.class);
    when(appState.fetch(eq(URL), any(String.class))).thenReturn(json.readTree(PAYLOAD));
    keys = new SupabaseKeysFile(dir.resolve("supabase-keys.json"), URL, json);
    identities = mock(EmployeeIdentityStore.class);
    cleanEvent = mock(CleanEventClient.class);
    controller = new LoginController("Europe/Rome", mock(PhoneLoginLimiter.class),
        cleanEvent, keys, identities, appState);
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
  void noVerifiedTokenMeans401AndNothingSaved() throws Exception {
    var res = controller.login(new MockHttpServletRequest(), body(SupabaseKeysFileTest.fakeJwt("anon")));
    assertEquals(401, res.getStatusCode().value());
    assertFalse(Files.exists(keys.path()));
    verify(appState, never()).fetch(any(), any());
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
    verify(appState).fetch(URL, anon);
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
    verify(appState, never()).fetch(any(), any());
  }

  @Test
  void serviceRoleKeyRefused() throws Exception {
    var res = controller.login(withClaims(), body(SupabaseKeysFileTest.fakeJwt("service_role")));
    assertEquals(400, res.getStatusCode().value());
    assertFalse(Files.exists(keys.path()));
    verify(appState, never()).fetch(any(), any());
  }

  @Test
  void supabaseFailureDoesNotSaveKeys() throws Exception {
    when(appState.fetch(eq(URL), any(String.class))).thenThrow(new SupabaseAppState.Unavailable());
    var res = controller.login(withClaims(), body(SupabaseKeysFileTest.fakeJwt("anon")));
    assertEquals(503, res.getStatusCode().value());
    assertNull(keys.read());
    verify(identities, never()).save(any(), any(), any(), any());
  }

  @Test
  void unknownPhoneIs404AndNoIdentity() throws Exception {
    String anon = SupabaseKeysFileTest.fakeJwt("anon");
    var ex = assertThrows(ResponseStatusException.class,
        () -> controller.login(withClaims(), Map.of("phone", "999", "supabaseUrl", URL, "supabaseAnonKey", anon)));
    assertEquals(404, ex.getStatusCode().value());
    verify(identities, never()).save(any(), any(), any(), any());
    assertTrue(Files.exists(keys.path()), "keys are saved once the token was valid and the database read succeeded");
  }

  @Test
  void employeeLookupUsesSavedAnonKey() throws Exception {
    String anon = SupabaseKeysFileTest.fakeJwt("anon");
    keys.save(URL, anon);
    when(appState.fetch(URL, anon)).thenReturn(json.readTree(PAYLOAD));
    Map<String, String> found = controller.employee("e1");
    assertEquals("Ana", found.get("name"));
    assertEquals("+39 333 111 2222", found.get("phone"));
    verify(appState).fetch(URL, anon);
  }
}
