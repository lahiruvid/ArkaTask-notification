package com.arkatasks.login;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.resilience4j.ratelimiter.RateLimiterConfig;
import io.github.resilience4j.ratelimiter.RateLimiterRegistry;
import java.time.Duration;
import org.junit.jupiter.api.Test;

class LoginRateLimitTest {
  static PhoneLoginLimiter limiter(int perPeriod) {
    return new PhoneLoginLimiter(RateLimiterRegistry.of(RateLimiterConfig.custom()
        .limitForPeriod(perPeriod)
        .limitRefreshPeriod(Duration.ofMinutes(15))
        .timeoutDuration(Duration.ZERO)
        .build()));
  }

  @Test
  void eachPhoneHasItsOwnBudget() {
    PhoneLoginLimiter limits = limiter(2);
    assertTrue(limits.allow("3331112222"));
    assertTrue(limits.allow("3331112222"));
    assertFalse(limits.allow("3331112222"));
    assertTrue(limits.allow("3339998888"));
  }

  @Test
  void registryIsTrimmedWhenTooManyPhonesAreTried() {
    PhoneLoginLimiter limits = limiter(1);
    for (int i = 0; i <= PhoneLoginLimiter.MAX_PHONES + 1; i++) {
      limits.allow("39" + i);
    }
    assertTrue(limits.allow("390"), "old per-phone limiters were dropped");
  }
}
