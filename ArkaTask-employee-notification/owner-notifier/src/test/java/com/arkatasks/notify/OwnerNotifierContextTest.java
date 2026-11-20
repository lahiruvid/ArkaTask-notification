package com.arkatasks.notify;

import static org.junit.jupiter.api.Assertions.assertNotNull;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/** The Spring wiring starts without RabbitMQ, Eureka, or login-service reachable. */
@SpringBootTest(properties = {
    "eureka.client.enabled=false",
    "spring.cloud.discovery.enabled=false",
    "management.tracing.enabled=false",
    "spring.rabbitmq.listener.simple.auto-startup=false"
})
class OwnerNotifierContextTest {
  @Autowired
  OwnerNotifier notifier;

  @Autowired
  LoginLookupClient loginLookup;

  @Test
  void notifierIsWired() {
    assertNotNull(notifier);
    assertNotNull(loginLookup);
  }
}
