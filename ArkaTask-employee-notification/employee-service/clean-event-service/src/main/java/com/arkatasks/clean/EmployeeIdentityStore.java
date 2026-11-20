package com.arkatasks.clean;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Reads the employee session login-service wrote on the shared volume.
 * This process does not open JDBC.
 */
@Component
public class EmployeeIdentityStore {
  public record Employee(String employeeId, String name, String phone) {}

  private final Path file;
  private final ObjectMapper json;

  public EmployeeIdentityStore(
      @Value("${app.session-file:/var/lib/arkatasks/employee-sessions.json}") String path,
      ObjectMapper json) {
    this.file = Path.of(path);
    this.json = json;
  }

  private static String text(Object value) {
    return value == null ? "" : String.valueOf(value);
  }

  public Employee find(String authUid) {
    if (authUid == null || authUid.isBlank() || !Files.isRegularFile(file)) return null;
    try {
      Map<?, ?> raw = json.readValue(Files.readString(file), Map.class);
      Object row = raw.get(authUid);
      if (!(row instanceof Map<?, ?> session)) return null;
      Object expires = session.get("expiresAt");
      long expiry = expires instanceof Number n ? n.longValue() : 0L;
      if (expiry <= Instant.now().toEpochMilli()) return null;
      return new Employee(
          text(session.get("employeeId")),
          text(session.get("name")),
          text(session.get("phone")));
    } catch (Exception ignored) {
      return null;
    }
  }
}
