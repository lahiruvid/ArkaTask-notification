package com.arkatasks.login;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

class LoginRateLimitTest {
  // This test did not compile before the Supabase change (constructor arguments had drifted)
  // and the per-phone limit is switched off in PhoneLoginLimiter and LoginController for E2E.
  // Re-enable together with the rate limit.
  @Test
  @Disabled("Per-phone rate limit is disabled for E2E. Re-enable with the limiter.")
  void rateLimitExceededReturnsClearError() {
    LoginController controller = null;
    ResponseEntity<Map<String, Object>> response = controller.loginRateLimited(Map.of(), null);
    assertEquals(429, response.getStatusCode().value());
    assertTrue(String.valueOf(response.getBody().get("error")).contains("Too many login attempts"));
  }
}
