package com.arkatasks.clean;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Requires a valid Supabase access token on the URLs it is registered for.
 * Valid claims go to the request attribute CLAIMS. Failures answer JSON 401 or 503.
 * The token itself is never logged.
 */
public class SupabaseAuthFilter extends OncePerRequestFilter {
  public static final String CLAIMS = "supabaseClaims";
  private static final Logger log = LoggerFactory.getLogger(SupabaseAuthFilter.class);

  private final SupabaseJwtVerifier verifier;

  public SupabaseAuthFilter(SupabaseJwtVerifier verifier) {
    this.verifier = verifier;
  }

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
      chain.doFilter(request, response);
      return;
    }
    Claims claims;
    try {
      claims = verifier.verify(request.getHeader("Authorization"));
    } catch (SupabaseJwtVerifier.AuthException ex) {
      log.info("Rejected {} {}: HTTP {} {}", request.getMethod(), request.getRequestURI(), ex.status(), ex.getMessage());
      response.setStatus(ex.status());
      if (ex.status() == 401) {
        response.setHeader("WWW-Authenticate", "Bearer");
      }
      response.setContentType("application/json");
      response.setCharacterEncoding(StandardCharsets.UTF_8.name());
      response.getWriter().write("{\"error\":\"" + ex.getMessage().replace("\"", "'") + "\"}");
      return;
    }
    request.setAttribute(CLAIMS, claims);
    chain.doFilter(request, response);
  }

  public static Claims claims(HttpServletRequest request) {
    Object value = request.getAttribute(CLAIMS);
    return value instanceof Claims c ? c : null;
  }
}
