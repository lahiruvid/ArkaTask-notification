package com.arkatasks.clean;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.rabbit.core.RabbitOperations;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

/** Kafka to Supabase clean_outbox, then clean_outbox to RabbitMQ with a confirm. */
class CleanOutboxTest {
  static final SupabaseKeysFile.Creds CREDS = CleanEventControllerTokenTest.CREDS;
  static final CleanEvent EVENT = new CleanEvent("a1", "Via Roma", "2026-11-20", "10:00", "e1", "Ana", "+39 333");

  SupabaseKeysFile keys;
  SupabaseRest supabase;
  RabbitTemplate rabbit;
  RabbitOperations operations;
  ObjectMapper json;
  CleanOutbox outbox;

  @BeforeEach
  @SuppressWarnings("unchecked")
  void setUp() {
    keys = mock(SupabaseKeysFile.class);
    supabase = mock(SupabaseRest.class);
    rabbit = mock(RabbitTemplate.class);
    operations = mock(RabbitOperations.class);
    json = new ObjectMapper();
    when(keys.read()).thenReturn(CREDS);
    when(rabbit.invoke(any(RabbitOperations.OperationsCallback.class))).thenAnswer(call ->
        ((RabbitOperations.OperationsCallback<Object>) call.getArgument(0)).doInRabbit(operations));
    outbox = new CleanOutbox(keys, supabase, rabbit, json, 20);
  }

  @Test
  void kafkaEventIsStoredAsPendingRow() throws Exception {
    outbox.store(json.writeValueAsString(EVENT));
    verify(supabase).insertOutbox(CREDS, EVENT);
  }

  @Test
  void eventStaysInKafkaWhileNoKeysAreKnown() {
    when(keys.read()).thenReturn(null);
    assertThrows(IllegalStateException.class, () -> outbox.store(json.writeValueAsString(EVENT)));
    verify(supabase, never()).insertOutbox(any(), any());
  }

  @Test
  void supabaseFailureIsRetriedByKafka() {
    doThrow(new SupabaseRest.Unavailable("down")).when(supabase).insertOutbox(CREDS, EVENT);
    assertThrows(SupabaseRest.Unavailable.class, () -> outbox.store("{\"apartmentId\":\"a1\",\"apartmentName\":\"Via Roma\","
        + "\"date\":\"2026-11-20\",\"time\":\"10:00\",\"employeeId\":\"e1\",\"employeeName\":\"Ana\","
        + "\"employeePhone\":\"+39 333\"}"));
  }

  @Test
  void relayPublishesWithConfirmThenMarksRelayed() {
    when(supabase.pendingOutbox(CREDS, 20)).thenReturn(List.of(EVENT));
    outbox.relay();
    var order = inOrder(operations, supabase);
    order.verify(operations).convertAndSend(eq("owner-notifications"), contains("\"apartmentName\":\"Via Roma\""));
    order.verify(operations).waitForConfirmsOrDie(5_000);
    order.verify(supabase).markRelayed(CREDS, EVENT);
  }

  @Test
  void unconfirmedPublishLeavesRowPending() {
    when(supabase.pendingOutbox(CREDS, 20)).thenReturn(List.of(EVENT));
    doThrow(new AmqpException("nack")).when(operations).waitForConfirmsOrDie(5_000);
    outbox.relay();
    verify(supabase, never()).markRelayed(any(), any());
  }

  @Test
  void relayIdlesWithoutKeysOrRows() {
    when(supabase.pendingOutbox(CREDS, 20)).thenReturn(List.of());
    outbox.relay();
    when(keys.read()).thenReturn(null);
    outbox.relay();
    verify(operations, never()).convertAndSend(anyString(), any(Object.class));
  }
}
