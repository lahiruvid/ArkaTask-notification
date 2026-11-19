package com.arkatasks.login;

import io.github.resilience4j.ratelimiter.RateLimiter;
import io.github.resilience4j.ratelimiter.RateLimiterConfig;
import io.github.resilience4j.ratelimiter.RateLimiterRegistry;
import org.springframework.stereotype.Component;

/** One Resilience4j limiter per phone, using the per-phone config in application.yml. */
@Component
public class PhoneLoginLimiter {
  private final RateLimiterRegistry registry;
  private final RateLimiterConfig config;

  public PhoneLoginLimiter(RateLimiterRegistry registry) {
    this.registry = registry;
    this.config = registry.rateLimiter("per-phone").getRateLimiterConfig();
  }

  public boolean allow(String phoneDigits) {
    RateLimiter limiter = registry.rateLimiter("per-phone-" + phoneDigits, config);
    return limiter.acquirePermission();
  }
}
