package com.arkatasks.login;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Employee session for this process, also written to the shared volume so
 * clean-event-service can read it. Not a database table and not a token store.
 */
@Component
public class EmployeeIdentityStore {
  public record Employee(String employeeId, String name, String phone) {}

  private record Session(String employeeId, String name, String phone, long expiresAt) {}

  private final Path file;
  private final ObjectMapper json;
  private final Map<String, Session> memory = new LinkedHashMap<>();

  public EmployeeIdentityStore(
      @Value("${app.session-file:/var/lib/arkatasks/employee-sessions.json}") String path,
      ObjectMapper json) {
    this.file = Path.of(path);
    this.json = json;
  }

  public synchronized void save(String authUid, String employeeId, String name, String phone) {
    if (authUid == null || authUid.isBlank()) return;
    forgetExpired();
    memory.put(authUid, new Session(
        employeeId,
        name == null ? "" : name,
        phone == null ? "" : phone,
        Instant.now().plusSeconds(12 * 3600).toEpochMilli()));
    write();
  }

  public synchronized Employee find(String authUid) {
    if (authUid == null || authUid.isBlank()) return null;
    load();
    forgetExpired();
    Session session = memory.get(authUid);
    return session == null ? null : new Employee(session.employeeId, session.name, session.phone);
  }

  private static String text(Object value) {
    return value == null ? "" : String.valueOf(value);
  }

  private void forgetExpired() {
    long now = Instant.now().toEpochMilli();
    memory.entrySet().removeIf(entry -> entry.getValue().expiresAt <= now);
  }

  private void load() {
    try {
      if (!Files.isRegularFile(file)) return;
      Map<?, ?> raw = json.readValue(Files.readString(file), Map.class);
      memory.clear();
      for (Map.Entry<?, ?> entry : raw.entrySet()) {
        if (!(entry.getValue() instanceof Map<?, ?> row)) continue;
        Object expires = row.get("expiresAt");
        memory.put(String.valueOf(entry.getKey()), new Session(
            text(row.get("employeeId")),
            text(row.get("name")),
            text(row.get("phone")),
            expires instanceof Number n ? n.longValue() : 0L));
      }
    } catch (Exception ignored) {
      // A missing or unreadable session file just means there is no session yet.
    }
  }

  private void write() {
    try {
      Path dir = file.toAbsolutePath().getParent();
      if (dir != null) Files.createDirectories(dir);
      Map<String, Map<String, Object>> body = new LinkedHashMap<>();
      for (Map.Entry<String, Session> entry : memory.entrySet()) {
        Session session = entry.getValue();
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("employeeId", session.employeeId);
        row.put("name", session.name);
        row.put("phone", session.phone);
        row.put("expiresAt", session.expiresAt);
        body.put(entry.getKey(), row);
      }
      Path tmp = Files.createTempFile(dir == null ? Path.of(".") : dir, ".sessions", ".tmp");
      Files.writeString(tmp, json.writeValueAsString(body));
      Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    } catch (Exception ex) {
      throw new IllegalStateException("Could not store the employee session.");
    }
  }
}
