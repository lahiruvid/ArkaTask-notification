package com.arkatasks.notify;

import io.github.resilience4j.retry.annotation.Retry;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
public class LoginLookupClient {
  private final RestTemplate http;
  private final String baseUrl;

  public LoginLookupClient(
      RestTemplate http,
      @Value("${app.login-service-url:http://login-service:8081}") String baseUrl) {
    this.http = http;
    this.baseUrl = baseUrl;
  }

  @Retry(name = "interService", fallbackMethod = "phoneFallback")
  public String phoneFor(String employeeId) {
    @SuppressWarnings("unchecked")
    var body = http.getForObject(baseUrl + "/api/employees/" + employeeId, java.util.Map.class);
    if (body == null || body.get("phone") == null) return "";
    return String.valueOf(body.get("phone"));
  }

  public String phoneFallback(String employeeId, Throwable ignored) {
    return "";
  }
}
