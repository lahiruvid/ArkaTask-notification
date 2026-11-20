package com.arkatasks.clean;

import static org.junit.jupiter.api.Assertions.assertNotNull;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/** The Spring wiring starts without Kafka, RabbitMQ, Eureka, or Supabase reachable. */
@SpringBootTest(properties = {
    "eureka.client.enabled=false",
    "spring.cloud.discovery.enabled=false",
    "management.tracing.enabled=false",
    "spring.kafka.listener.auto-startup=false",
    "spring.kafka.admin.auto-create=false",
    "spring.rabbitmq.listener.simple.auto-startup=false",
    "supabase.keys-file=target/test-keys/supabase-keys.json",
    "app.outbox.relay-initial-delay-ms=3600000"
})
class CleanEventContextTest {
  @Autowired
  CleanEventController controller;

  @Autowired
  CleanOutbox outbox;

  @Autowired
  SupabaseRest supabase;

  @Test
  void tapControllerAndOutboxAreWired() {
    assertNotNull(controller);
    assertNotNull(outbox);
    assertNotNull(supabase);
  }
}
