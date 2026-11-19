package com.arkatasks.login;

import io.github.resilience4j.retry.annotation.Retry;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class CleanEventClient {
  private final RestTemplate http;
  private final String baseUrl;

  public CleanEventClient(
      RestTemplate http,
      @Value("${app.clean-event-url:http://clean-event-service:8082}") String baseUrl) {
    this.http = http;
    this.baseUrl = baseUrl;
  }

  @Retry(name = "interService", fallbackMethod = "employeeOpenedFallback")
  public void employeeOpened(String employeeId, String name) {
    http.postForEntity(
        baseUrl + "/api/employee-logins",
        Map.of("employeeId", employeeId, "name", name),
        Void.class);
  }

  public void employeeOpenedFallback(String employeeId, String name, Throwable ignored) {
    // Login still succeeds when clean-event-service is down after the retries.
  }
}
