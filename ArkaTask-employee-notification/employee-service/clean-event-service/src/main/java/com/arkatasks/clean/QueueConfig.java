package com.arkatasks.clean;

import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class QueueConfig {
  @Bean
  Queue ownerNotifications() {
    return new Queue(CleanEventController.QUEUE, true);
  }
}
