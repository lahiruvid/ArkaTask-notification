package com.arkatasks.clean;

import io.github.resilience4j.retry.annotation.Retry;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;

@Component
public class OwnerNotifierClient {
  private final RestTemplate http;
  private final String baseUrl;

  public OwnerNotifierClient(
      RestTemplate http,
      @Value("${app.owner-notifier-url:http://owner-notifier:8083}") String baseUrl) {
    this.http = http;
    this.baseUrl = baseUrl;
  }

  @Retry(name = "interService", fallbackMethod = "deliverFallback")
  public void deliver(String eventJson) {
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.APPLICATION_JSON);
    http.postForEntity(baseUrl + "/api/notifications", new HttpEntity<>(eventJson, headers), Void.class);
  }

  public void deliverFallback(String eventJson, Throwable ignored) {
    // RabbitMQ delivery still carries the event when this HTTP call is exhausted.
  }
}
