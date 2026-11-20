package com.arkatasks.clean;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Wires the Supabase keys, the JWKS cache, the token verifier, and the auth filter. */
@Configuration
public class SupabaseAuthConfig {
  private static final Logger log = LoggerFactory.getLogger(SupabaseAuthConfig.class);

  static final String[] PROTECTED_PATHS = {"/api/cleans"};

  @Bean
  SupabaseKeysFile supabaseKeysFile(
      @Value("${supabase.url:}") String supabaseUrl,
      @Value("${supabase.anon-key:}") String anonKey,
      @Value("${supabase.keys-file:/var/lib/arkatasks/supabase-keys.json}") String path,
      ObjectMapper json) {
    return new SupabaseKeysFile(Path.of(path), supabaseUrl, anonKey, json);
  }

  /**
   * The project comes from SUPABASE_URL (pinned), else from the keys file login-service saved.
   * With neither, the filter adopts the project once login-service has saved the keys file. The JWKS URL is always derived
   * from https://&lt;project-ref&gt;.supabase.co and never taken from a client.
   */
  @Bean
  SupabaseJwtVerifier supabaseJwtVerifier(
      ObjectMapper json,
      SupabaseKeysFile keys,
      @Value("${supabase.audience:authenticated}") String audience,
      @Value("${supabase.allowed-algs:RS256,ES256}") String allowedAlgs,
      @Value("${supabase.clock-skew-seconds:30}") long clockSkew,
      @Value("${supabase.jwks-min-refresh-seconds:60}") long minRefresh,
      @Value("${supabase.jwks-startup-attempts:3}") int startupAttempts,
      @Value("${supabase.jwks-retry-seconds:30}") long retrySeconds,
      @Value("${supabase.allow-missing-config:false}") boolean allowMissing) {
    Set<String> algs = Arrays.stream(allowedAlgs.split(","))
        .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
    boolean pinned = !keys.expectedUrl().isEmpty();
    String base = keys.expectedUrl();
    if (!pinned) {
      SupabaseKeysFile.Creds saved = keys.read();
      base = saved == null ? "" : saved.url();
    }
    if (base.isEmpty()) {
      String message = "SUPABASE_URL is not set and no employee has signed in yet. "
          + "Set SUPABASE_URL=https://<project-ref>.supabase.co to pin the project.";
      if (!allowMissing) {
        throw new IllegalStateException(message);
      }
      log.warn("{} Clean taps answer 503 until login-service saves the keys file.", message);
      return new SupabaseJwtVerifier(null, "", audience, algs, clockSkew);
    }
    String iss = SupabaseKeysFile.requireProjectUrl(base) + "/auth/v1";
    SupabaseJwks cache = new SupabaseJwks(
        URI.create(iss + "/.well-known/jwks.json"), SupabaseJwks.httpsFetcher(), json,
        Duration.ofSeconds(minRefresh), Clock.systemUTC());
    cache.loadAtStartup(startupAttempts, Duration.ofSeconds(2), Duration.ofSeconds(retrySeconds));
    return new SupabaseJwtVerifier(cache, iss, audience, algs, clockSkew, pinned);
  }

  @Bean
  FilterRegistrationBean<SupabaseAuthFilter> supabaseAuthFilter(
      SupabaseJwtVerifier verifier, SupabaseKeysFile keys) {
    FilterRegistrationBean<SupabaseAuthFilter> reg = new FilterRegistrationBean<>(new SupabaseAuthFilter(verifier, keys));
    reg.addUrlPatterns(PROTECTED_PATHS);
    reg.setOrder(1);
    return reg;
  }
}
