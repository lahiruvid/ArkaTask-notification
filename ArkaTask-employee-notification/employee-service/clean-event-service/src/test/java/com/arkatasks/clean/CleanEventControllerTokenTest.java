package com.arkatasks.clean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

/** Clean tap: Supabase token identity, outbox duplicate check, then Kafka with a broker ack. */
class CleanEventControllerTokenTest {
  static final SupabaseKeysFile.Creds CREDS =
      new SupabaseKeysFile.Creds("https://testref.supabase.co", SupabaseKeysFileTest.fakeJwt("anon"));
  static final Map<String, String> TAP = Map.of("apartmentId", "a1", "date", "2026-11-20");

  KafkaTemplate<String, String> kafka;
  EmployeeIdentityStore identities;
  SupabaseKeysFile keys;
  SupabaseRest supabase;
  CleanEventController controller;

  @BeforeEach
  @SuppressWarnings("unchecked")
  void setUp() {
    kafka = mock(KafkaTemplate.class);
    identities = mock(EmployeeIdentityStore.class);
    keys = mock(SupabaseKeysFile.class);
    supabase = mock(SupabaseRest.class);
    when(keys.read()).thenReturn(CREDS);
    when(supabase.apartmentName(CREDS, "a1", "2026-11-20", "e1")).thenReturn("Via Roma");
    SendResult<String, String> sent = mock(SendResult.class);
    when(kafka.send(anyString(), anyString(), anyString())).thenReturn(CompletableFuture.completedFuture(sent));
    controller = new CleanEventController(kafka, new ObjectMapper(), "Europe/Rome", identities, keys, supabase);
  }

  MockHttpServletRequest req(String sub) {
    var request = new MockHttpServletRequest("POST", "/api/cleans");
    if (sub != null) {
      request.setAttribute(SupabaseAuthFilter.CLAIMS,
          Jwts.claims().subject(sub).add("role", "authenticated").build());
    }
    return request;
  }

  @Test
  void tapGoesToKafkaWithTheApartmentName() throws Exception {
    when(identities.find("uid-1")).thenReturn(new EmployeeIdentityStore.Employee("e1", "Ana", "+39 333"));
    Map<String, Object> out = controller.markClean(req("uid-1"), TAP);
    assertEquals("accepted", out.get("status"));
    verify(kafka).send(eq("clean-events"), eq("e1:a1:2026-11-20"), contains("\"apartmentName\":\"Via Roma\""));
    verify(kafka).send(anyString(), anyString(), contains("\"employeePhone\":\"+39 333\""));
  }

  @Test
  void duplicateTapIsNotSentAgain() throws Exception {
    when(identities.find("uid-1")).thenReturn(new EmployeeIdentityStore.Employee("e1", "Ana", ""));
    when(supabase.outboxHas(CREDS, "a1", "2026-11-20", "e1")).thenReturn(true);
    assertEquals("already-recorded", controller.markClean(req("uid-1"), TAP).get("status"));
    verify(kafka, never()).send(anyString(), anyString(), anyString());
  }

  @Test
  void supabaseOutageStillRecordsTheTap() throws Exception {
    when(identities.find("uid-1")).thenReturn(new EmployeeIdentityStore.Employee("e1", "Ana", ""));
    when(supabase.outboxHas(any(), anyString(), anyString(), anyString()))
        .thenThrow(new SupabaseRest.Unavailable("down"));
    assertEquals("accepted", controller.markClean(req("uid-1"), TAP).get("status"));
    verify(kafka).send(eq("clean-events"), eq("e1:a1:2026-11-20"), contains("\"apartmentName\":\"a1\""));
  }

  @Test
  void kafkaDownIs503() {
    when(identities.find("uid-1")).thenReturn(new EmployeeIdentityStore.Employee("e1", "Ana", ""));
    when(kafka.send(anyString(), anyString(), anyString()))
        .thenReturn(CompletableFuture.failedFuture(new IllegalStateException("no broker")));
    var ex = assertThrows(ResponseStatusException.class, () -> controller.markClean(req("uid-1"), TAP));
    assertEquals(503, ex.getStatusCode().value());
  }

  @Test
  void badDateIs400() {
    when(identities.find("uid-1")).thenReturn(new EmployeeIdentityStore.Employee("e1", "Ana", ""));
    var ex = assertThrows(ResponseStatusException.class,
        () -> controller.markClean(req("uid-1"), Map.of("apartmentId", "a1", "date", "20/11/2026")));
    assertEquals(400, ex.getStatusCode().value());
    verify(kafka, never()).send(anyString(), anyString(), anyString());
  }

  @Test
  void unverifiedRequestIs401() {
    var ex = assertThrows(ResponseStatusException.class, () -> controller.markClean(req(null), TAP));
    assertEquals(401, ex.getStatusCode().value());
    verify(kafka, never()).send(anyString(), anyString(), anyString());
  }

  @Test
  void tokenWithoutEmployeeLoginIs401() {
    var ex = assertThrows(ResponseStatusException.class, () -> controller.markClean(req("stranger"), TAP));
    assertEquals(401, ex.getStatusCode().value());
    verify(kafka, never()).send(anyString(), anyString(), anyString());
  }
}
