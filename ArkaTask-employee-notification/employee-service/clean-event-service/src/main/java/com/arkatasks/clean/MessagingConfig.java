package com.arkatasks.clean;

import com.fasterxml.jackson.core.JsonProcessingException;
import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.ExponentialBackOff;

/** Kafka topic, the RabbitMQ queue owner-notifier reads, and the Kafka retry policy. */
@Configuration
public class MessagingConfig {
  static final String TOPIC = "clean-events";
  static final String QUEUE = "owner-notifications";

  @Bean
  NewTopic cleanEventsTopic() {
    return TopicBuilder.name(TOPIC).partitions(1).replicas(1).build();
  }

  @Bean
  Queue ownerNotifications() {
    return new Queue(QUEUE, true);
  }

  /**
   * A clean event stays in Kafka until Supabase accepts the outbox row: retries back off
   * from 2 s to at most 60 s and never give up. Malformed JSON is skipped, not retried.
   */
  @Bean
  DefaultErrorHandler kafkaErrorHandler() {
    ExponentialBackOff backOff = new ExponentialBackOff(2_000L, 2.0);
    backOff.setMaxInterval(60_000L);
    DefaultErrorHandler handler = new DefaultErrorHandler(backOff);
    handler.addNotRetryableExceptions(JsonProcessingException.class);
    return handler;
  }
}
