package com.arkatasks.login;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class SupabaseAuthFilterTest {
  SupabaseJwtVerifierTest fx;
  SupabaseJwtVerifier verifier;

  @org.junit.jupiter.api.BeforeEach
  void setUp() throws Exception {
    fx = new SupabaseJwtVerifierTest();
    fx.setUp();
    verifier = fx.verifier;
  }

  String valid() {
    return fx.valid();
  }
  @Test
  void missingHeaderGets401Json() throws Exception {
    var filter = new SupabaseAuthFilter(verifier);
    var req = new MockHttpServletRequest("POST", "/api/test");
    var res = new MockHttpServletResponse();
    var chain = new MockFilterChain();
    filter.doFilter(req, res, chain);
    assertEquals(401, res.getStatus());
    assertEquals("Bearer", res.getHeader("WWW-Authenticate"));
    assertEquals("{\"error\":\"Employee login is required.\"}", res.getContentAsString());
    assertNull(chain.getRequest(), "chain must not continue");
  }

  @Test
  void badTokenBodyDoesNotEchoTheToken() throws Exception {
    String t = SupabaseJwtVerifierTest.token(fx.main.getPrivate(), "kid-1", SupabaseJwtVerifierTest.ISS, "wrong", Instant.now().plusSeconds(3600), "authenticated");
    var req = new MockHttpServletRequest("POST", "/api/test");
    req.addHeader("Authorization", "Bearer " + t);
    var res = new MockHttpServletResponse();
    new SupabaseAuthFilter(verifier).doFilter(req, res, new MockFilterChain());
    assertEquals(401, res.getStatus());
    assertFalse(res.getContentAsString().contains(t.substring(0, 20)));
  }

  @Test
  void validTokenContinuesWithClaims() throws Exception {
    var req = new MockHttpServletRequest("POST", "/api/test");
    req.addHeader("Authorization", "Bearer " + valid());
    var res = new MockHttpServletResponse();
    var chain = new MockFilterChain();
    new SupabaseAuthFilter(verifier).doFilter(req, res, chain);
    assertEquals(200, res.getStatus());
    assertNotNull(chain.getRequest());
    assertNotNull(SupabaseAuthFilter.claims(req));
  }

  @Test
  void corsPreflightPassesThrough() throws Exception {
    var req = new MockHttpServletRequest("OPTIONS", "/api/test");
    var chain = new MockFilterChain();
    new SupabaseAuthFilter(verifier).doFilter(req, new MockHttpServletResponse(), chain);
    assertNotNull(chain.getRequest());
  }

  @Test
  void keysNotLoadedGets503() throws Exception {
    var v = new SupabaseJwtVerifier(null, "", "authenticated", java.util.Set.of("RS256"), 30);
    var req = new MockHttpServletRequest("POST", "/api/test");
    req.addHeader("Authorization", "Bearer " + valid());
    var res = new MockHttpServletResponse();
    new SupabaseAuthFilter(v).doFilter(req, res, new MockFilterChain());
    assertEquals(503, res.getStatus());
  }
}
