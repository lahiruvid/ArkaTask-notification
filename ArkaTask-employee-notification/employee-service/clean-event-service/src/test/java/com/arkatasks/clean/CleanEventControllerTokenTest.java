package com.arkatasks.clean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.server.ResponseStatusException;

/** Postgres outbox, Kafka, and the RabbitMQ relay, with the Supabase token identity. */
class CleanEventControllerTokenTest {
  static final String JOBS = "{\"jobs\":[{\"property_id\":\"a1\",\"date\":\"2026-11-20\",\"place_name\":\"Via Roma\","
      + "\"job_assignments\":[{\"employee_id\":\"e1\"}]}]}";

  JdbcTemplate jdbc;
  KafkaTemplate<String, String> kafka;
  RabbitTemplate rabbit;
  OwnerNotifierClient notifier;
  EmployeeIdentityStore identities;
  CleanEventController controller;

  @BeforeEach
  @SuppressWarnings("unchecked")
  void setUp() {
    jdbc = mock(JdbcTemplate.class);
    kafka = mock(KafkaTemplate.class);
    rabbit = mock(RabbitTemplate.class);
    notifier = mock(OwnerNotifierClient.class);
    identities = mock(EmployeeIdentityStore.class);
    when(jdbc.query(anyString(), any(ResultSetExtractor.class))).thenReturn(JOBS);
    controller = new CleanEventController(jdbc, kafka, rabbit, new ObjectMapper(),
        "Europe/Rome", notifier, identities);
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
  void tapWritesOutboxThenPublishesKafka() throws Exception {
    when(identities.find("uid-1")).thenReturn(new EmployeeIdentityStore.Employee("e1", "Ana", "+39 333"));
    when(jdbc.update(startsWith("insert into clean_outbox"), any(), any(), any(), any(), any(), any(), any()))
        .thenReturn(1);
    Map<String, Object> out = controller.markClean(req("uid-1"), Map.of("apartmentId", "a1", "date", "2026-11-20"));
    assertEquals("accepted", out.get("status"));
    verify(jdbc).update(startsWith("insert into clean_outbox"),
        eq("a1"), eq("2026-11-20"), eq("e1"), eq("Ana"), eq("+39 333"), eq("Via Roma"), anyString());
    verify(kafka).send(eq("clean-events"), eq("e1:a1:2026-11-20"), contains("\"employeeName\":\"Ana\""));
  }

  @Test
  void duplicateTapDoesNotPublishAgain() throws Exception {
    when(identities.find("uid-1")).thenReturn(new EmployeeIdentityStore.Employee("e1", "Ana", ""));
    when(jdbc.update(startsWith("insert into clean_outbox"), any(), any(), any(), any(), any(), any(), any()))
        .thenReturn(0);
    assertEquals("already-recorded",
        controller.markClean(req("uid-1"), Map.of("apartmentId", "a1", "date", "2026-11-20")).get("status"));
    verify(kafka, never()).send(anyString(), anyString(), anyString());
  }

  @Test
  void unverifiedRequestIs401() {
    var ex = assertThrows(ResponseStatusException.class,
        () -> controller.markClean(req(null), Map.of("apartmentId", "a1", "date", "2026-11-20")));
    assertEquals(401, ex.getStatusCode().value());
    verify(jdbc, never()).update(anyString(), any(Object[].class));
  }

  @Test
  void tokenWithoutEmployeeLoginIs401() {
    var ex = assertThrows(ResponseStatusException.class,
        () -> controller.markClean(req("stranger"), Map.of("apartmentId", "a1", "date", "2026-11-20")));
    assertEquals(401, ex.getStatusCode().value());
    verify(kafka, never()).send(anyString(), anyString(), anyString());
  }

  @Test
  void relaySendsRabbitAndOwnerNotifierThenMarksRelayed() throws Exception {
    when(jdbc.queryForList(startsWith("select"))).thenReturn(List.of(Map.of(
        "apartment_id", "a1",
        "date", "2026-11-20",
        "employee_id", "e1",
        "employee_name", "Ana",
        "employee_phone", "+39 333",
        "apartment_name", "Via Roma",
        "clean_time", "10:00")));
    controller.relayPending();
    verify(rabbit).convertAndSend(eq("owner-notifications"), contains("\"apartmentName\":\"Via Roma\""));
    verify(notifier).deliver(contains("\"employeePhone\":\"+39 333\""));
    verify(jdbc).update(startsWith("update clean_outbox"), eq("a1"), eq("2026-11-20"), eq("e1"));
  }

  @Test
  void relayIdlesWhenOutboxIsEmpty() throws Exception {
    when(jdbc.queryForList(anyString())).thenReturn(List.of());
    controller.relayPending();
    verify(rabbit, never()).convertAndSend(anyString(), anyString());
    verify(notifier, never()).deliver(anyString());
  }
}
