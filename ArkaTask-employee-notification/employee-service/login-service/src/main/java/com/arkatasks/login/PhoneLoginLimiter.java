package com.arkatasks.login;

import io.github.resilience4j.ratelimiter.RateLimiter;
import io.github.resilience4j.ratelimiter.RateLimiterConfig;
import io.github.resilience4j.ratelimiter.RateLimiterRegistry;
import org.springframework.stereotype.Component;

/**
 * One Resilience4j limiter per phone number, using the per-phone config in application.yml.
 * The registry is cleared of per-phone limiters when it grows past MAX_PHONES, so random
 * numbers cannot grow memory without bound.
 */
@Component
public class PhoneLoginLimiter {
  static final int MAX_PHONES = 10_000;
  private static final String PREFIX = "per-phone-";

  private final RateLimiterRegistry registry;
  private final RateLimiterConfig config;

  public PhoneLoginLimiter(RateLimiterRegistry registry) {
    this.registry = registry;
    this.config = registry.rateLimiter("per-phone").getRateLimiterConfig();
  }

  public boolean allow(String phoneDigits) {
    if (registry.getAllRateLimiters().size() > MAX_PHONES) {
      for (RateLimiter limiter : registry.getAllRateLimiters()) {
        if (limiter.getName().startsWith(PREFIX)) {
          registry.remove(limiter.getName());
        }
      }
    }
    return registry.rateLimiter(PREFIX + phoneDigits, config).acquirePermission();
  }
}
