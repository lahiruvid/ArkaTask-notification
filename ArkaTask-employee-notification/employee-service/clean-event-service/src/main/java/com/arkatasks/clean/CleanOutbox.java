package com.arkatasks.clean;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Transactional outbox in Supabase.
 *
 * <p>1. Kafka listener: each clean event is inserted into clean_outbox as PENDING. When Supabase
 * is down or no keys are known yet, the listener fails and Kafka redelivers with back-off.
 *
 * <p>2. Relay: PENDING rows are published to the RabbitMQ queue owner-notifier reads, with a
 * publisher confirm, and only then marked RELAYED. A crash between the two sends the notice
 * again rather than losing it.
 */
@Component
public class CleanOutbox {
  private static final Logger log = LoggerFactory.getLogger(CleanOutbox.class);

  private final SupabaseKeysFile keys;
  private final SupabaseRest supabase;
  private final RabbitTemplate rabbit;
  private final ObjectMapper json;
  private final int batchSize;

  public CleanOutbox(
      SupabaseKeysFile keys,
      SupabaseRest supabase,
      RabbitTemplate rabbit,
      ObjectMapper json,
      @Value("${app.outbox.batch-size:20}") int batchSize) {
    this.keys = keys;
    this.supabase = supabase;
    this.rabbit = rabbit;
    this.json = json;
    this.batchSize = batchSize;
  }

  @KafkaListener(topics = MessagingConfig.TOPIC, groupId = "${app.outbox.consumer-group:clean-event-outbox}")
  public void store(String payload) throws Exception {
    CleanEvent event = json.readValue(payload, CleanEvent.class);
    SupabaseKeysFile.Creds creds = keys.read();
    if (creds == null) {
      throw new IllegalStateException("Supabase keys are not configured yet. The clean event stays in Kafka.");
    }
    supabase.insertOutbox(creds, event);
  }

  @Scheduled(
      initialDelayString = "${app.outbox.relay-initial-delay-ms:15000}",
      fixedDelayString = "${app.outbox.relay-interval-ms:5000}")
  public void relay() {
    SupabaseKeysFile.Creds creds = keys.read();
    if (creds == null) {
      return;
    }
    List<CleanEvent> pending;
    try {
      pending = supabase.pendingOutbox(creds, batchSize);
    } catch (RuntimeException ex) {
      log.warn("Outbox relay could not read Supabase: {}", ex.getMessage());
      return;
    }
    for (CleanEvent event : pending) {
      try {
        String body = json.writeValueAsString(event);
        rabbit.invoke(operations -> {
          operations.convertAndSend(MessagingConfig.QUEUE, body);
          operations.waitForConfirmsOrDie(5_000);
          return null;
        });
        supabase.markRelayed(creds, event);
      } catch (Exception ex) {
        // Keep the order: stop here and retry this row on the next run.
        log.warn("Outbox relay stopped at {}: {}", CleanEvent.keyOf(event), ex.getMessage());
        return;
      }
    }
  }
}
