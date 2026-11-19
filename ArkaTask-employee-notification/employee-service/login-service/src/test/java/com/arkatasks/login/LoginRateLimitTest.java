package com.arkatasks.login;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

class LoginRateLimitTest {
  @Test
  void rateLimitExceededReturnsClearError() throws Exception {
    PhoneLoginLimiter limits = mock(PhoneLoginLimiter.class);
    when(limits.allow("393331112222")).thenReturn(false);
    LoginController controller = new LoginController(
        mock(JdbcTemplate.class),
        new ObjectMapper(),
        "Europe/Rome",
        writeDevKey().toString(),
        12,
        limits,
        mock(CleanEventClient.class));

    ResponseEntity<Map<String, Object>> response =
        controller.login(Map.of("phone", "+39 333 111 2222"));

    assertEquals(429, response.getStatusCode().value());
    assertTrue(String.valueOf(response.getBody().get("error")).contains("Too many login attempts"));
    verify(limits).allow("393331112222");
  }

  private static Path writeDevKey() throws Exception {
    var pair = KeyPairGenerator.getInstance("RSA");
    pair.initialize(2048);
    String body = Base64.getMimeEncoder(64, new byte[] {'\n'})
        .encodeToString(pair.generateKeyPair().getPrivate().getEncoded());
    Path path = Files.createTempFile("login-test", ".pem");
    Files.writeString(path, "-----BEGIN PRIVATE KEY-----\n" + body + "\n-----END PRIVATE KEY-----\n");
    return path;
  }
}
