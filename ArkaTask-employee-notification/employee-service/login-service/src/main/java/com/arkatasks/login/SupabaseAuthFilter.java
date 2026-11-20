package com.arkatasks.login;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
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
    HttpServletRequest current = request;
    if (!verifier.ready() && "POST".equalsIgnoreCase(request.getMethod())) {
      byte[] body = request.getInputStream().readAllBytes();
      current = new CachedBodyRequest(request, body);
      String projectUrl = jsonStringField(new String(body, StandardCharsets.UTF_8), "supabaseUrl");
      if (!projectUrl.isEmpty()) {
        try {
          verifier.adoptProject(projectUrl);
        } catch (SupabaseJwtVerifier.AuthException ex) {
          reject(response, request, ex);
          return;
        }
      }
    }
    Claims claims;
    try {
      claims = verifier.verify(current.getHeader("Authorization"));
    } catch (SupabaseJwtVerifier.AuthException ex) {
      reject(response, current, ex);
      return;
    }
    current.setAttribute(CLAIMS, claims);
    chain.doFilter(current, response);
  }

  private void reject(HttpServletResponse response, HttpServletRequest request, SupabaseJwtVerifier.AuthException ex)
      throws IOException {
    log.info("Rejected {} {}: HTTP {} {}", request.getMethod(), request.getRequestURI(), ex.status(), ex.getMessage());
    response.setStatus(ex.status());
    if (ex.status() == 401) {
      response.setHeader("WWW-Authenticate", "Bearer");
    }
    response.setContentType("application/json");
    response.setCharacterEncoding(StandardCharsets.UTF_8.name());
    response.getWriter().write("{\"error\":\"" + ex.getMessage().replace("\"", "'") + "\"}");
  }

  /** Reads one JSON string field. Does not log the body, so an anon key in it stays out of the log. */
  static String jsonStringField(String body, String field) {
    String needle = "\"" + field + "\"";
    int at = body.indexOf(needle);
    if (at < 0) return "";
    int colon = body.indexOf(':', at + needle.length());
    if (colon < 0) return "";
    int open = body.indexOf('"', colon + 1);
    if (open < 0) return "";
    int close = body.indexOf('"', open + 1);
    if (close < 0) return "";
    return body.substring(open + 1, close);
  }

  private static final class CachedBodyRequest extends HttpServletRequestWrapper {
    private final byte[] body;

    CachedBodyRequest(HttpServletRequest request, byte[] body) {
      super(request);
      this.body = body;
    }

    @Override
    public ServletInputStream getInputStream() {
      ByteArrayInputStream input = new ByteArrayInputStream(body);
      return new ServletInputStream() {
        @Override
        public boolean isFinished() {
          return input.available() == 0;
        }

        @Override
        public boolean isReady() {
          return true;
        }

        @Override
        public void setReadListener(ReadListener listener) {}

        @Override
        public int read() {
          return input.read();
        }
      };
    }

    @Override
    public BufferedReader getReader() {
      return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
    }
  }

  public static Claims claims(HttpServletRequest request) {
    Object value = request.getAttribute(CLAIMS);
    return value instanceof Claims c ? c : null;
  }
}
