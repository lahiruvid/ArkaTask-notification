package com.arkatasks.login;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
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

/** Wires the Supabase JWKS cache, the token verifier, and the auth filter. */
@Configuration
public class SupabaseAuthConfig {
  private static final Logger log = LoggerFactory.getLogger(SupabaseAuthConfig.class);

  @Bean
  SupabaseJwtVerifier supabaseJwtVerifier(
      ObjectMapper json,
      @Value("${supabase.url:}") String supabaseUrl,
      @Value("${supabase.jwks-url:}") String jwksUrl,
      @Value("${supabase.issuer:}") String issuer,
      @Value("${supabase.audience:authenticated}") String audience,
      @Value("${supabase.allowed-algs:RS256,ES256}") String allowedAlgs,
      @Value("${supabase.clock-skew-seconds:30}") long clockSkew,
      @Value("${supabase.jwks-min-refresh-seconds:60}") long minRefresh,
      @Value("${supabase.jwks-startup-attempts:3}") int startupAttempts,
      @Value("${supabase.jwks-retry-seconds:30}") long retrySeconds,
      @Value("${supabase.allow-missing-config:false}") boolean allowMissing) {
    String base = SupabaseKeysFile.normalizeUrl(supabaseUrl);
    String jwks = jwksUrl.isBlank() && !base.isEmpty() ? base + "/auth/v1/.well-known/jwks.json" : jwksUrl.trim();
    String iss = issuer.isBlank() && !base.isEmpty() ? base + "/auth/v1" : issuer.trim();
    Set<String> algs = Arrays.stream(allowedAlgs.split(","))
        .map(String::trim).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
    if (jwks.isEmpty() || iss.isEmpty()) {
      String message = "SUPABASE_URL is not set. Set SUPABASE_URL=https://<project-ref>.supabase.co "
          + "(or SUPABASE_JWKS_URL and SUPABASE_JWT_ISSUER). The JWKS is only ever fetched from this "
          + "configured URL, never from a URL a client sends.";
      if (!allowMissing) {
        throw new IllegalStateException(message);
      }
      log.error("{} Running anyway because supabase.allow-missing-config=true; token checks answer 503.", message);
      return new SupabaseJwtVerifier(null, "", audience, algs, clockSkew);
    }
    SupabaseJwks cache = new SupabaseJwks(
        URI.create(jwks), SupabaseJwks.httpsFetcher(), json, Duration.ofSeconds(minRefresh), Clock.systemUTC());
    cache.loadAtStartup(startupAttempts, Duration.ofSeconds(2), Duration.ofSeconds(retrySeconds));
    return new SupabaseJwtVerifier(cache, iss, audience, algs, clockSkew);
  }

  @Bean
  SupabaseKeysFile supabaseKeysFile(
      @Value("${supabase.url:}") String supabaseUrl,
      @Value("${supabase.keys-file:/var/lib/arkatasks/supabase-keys.json}") String path,
      ObjectMapper json) {
    return new SupabaseKeysFile(java.nio.file.Path.of(path), supabaseUrl, json);
  }

  @Bean
  FilterRegistrationBean<SupabaseAuthFilter> supabaseAuthFilter(SupabaseJwtVerifier verifier) {
    FilterRegistrationBean<SupabaseAuthFilter> reg = new FilterRegistrationBean<>(new SupabaseAuthFilter(verifier));
    reg.addUrlPatterns(PROTECTED_PATHS);
    reg.setOrder(1);
    return reg;
  }

  static final String[] PROTECTED_PATHS = {"/api/login"};
}
