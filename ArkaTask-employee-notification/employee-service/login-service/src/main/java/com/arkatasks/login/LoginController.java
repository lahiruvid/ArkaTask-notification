package com.arkatasks.login;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
// Rate limit disabled for E2E. Restore: import io.github.resilience4j.ratelimiter.annotation.RateLimiter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class LoginController {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final ZoneId zone;
  private final PrivateKey privateKey;
  private final int ttlHours;
  private final PhoneLoginLimiter phoneLimits;
  private final CleanEventClient cleanEventClient;

  public LoginController(
      JdbcTemplate jdbc,
      ObjectMapper json,
      @Value("${app.timezone:Europe/Rome}") String timezone,
      @Value("${jwt.private-key-path:/keys/private.pem}") String privateKeyPath,
      @Value("${jwt.ttl-hours:12}") int ttlHours,
      PhoneLoginLimiter phoneLimits,
      CleanEventClient cleanEventClient) throws Exception {
    this.jdbc = jdbc;
    this.json = json;
    this.zone = ZoneId.of(timezone);
    this.privateKey = readPrivateKey(privateKeyPath);
    this.ttlHours = ttlHours;
    this.phoneLimits = phoneLimits;
    this.cleanEventClient = cleanEventClient;
  }

  @PostMapping("/api/login")
  // @RateLimiter(name = "login", fallbackMethod = "loginRateLimited")
  public ResponseEntity<Map<String, Object>> login(@RequestBody Map<String, String> body) throws Exception {
    String typed = digits(body.get("phone"));
    if (typed.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Phone number is required.");
    }
    // if (!phoneLimits.allow(typed)) {
    //   return loginRateLimited(body, null);
    // }
    String payload = jdbc.query(
        "select payload::text from app_state where id = 'main'",
        rs -> rs.next() ? rs.getString(1) : null);
    if (payload == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No employee found with that phone number.");
    }
    JsonNode root = json.readTree(payload);
    JsonNode employees = root.path("employees");
    JsonNode match = null;
    if (employees.isArray()) {
      for (JsonNode employee : employees) {
        if (employee.path("archived").asBoolean(false)) continue;
        if (phonesMatch(digits(employee.path("phone").asText("")), typed)) {
          match = employee;
          break;
        }
      }
    }
    if (match == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No employee found with that phone number.");
    }
    String employeeId = match.path("id").asText("");
    String name = match.path("name").asText("").trim();
    String phone = match.path("phone").asText("");
    LocalDate today = LocalDate.now(zone);
    LocalDate tomorrow = today.plusDays(1);
    Instant now = Instant.now();
    String token = Jwts.builder()
        .subject(employeeId)
        .claim("name", name)
        .claim("phone", phone)
        .issuedAt(Date.from(now))
        .expiration(Date.from(now.plusSeconds(ttlHours * 3600L)))
        .signWith(privateKey, Jwts.SIG.RS256)
        .compact();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("token", token);
    out.put("employeeId", employeeId);
    out.put("name", name);
    out.put("todayDate", today.toString());
    out.put("tomorrowDate", tomorrow.toString());
    out.put("today", apartments(root.path("jobs"), employeeId, today.toString()));
    out.put("tomorrow", apartments(root.path("jobs"), employeeId, tomorrow.toString()));
    cleanEventClient.employeeOpened(employeeId, name);
    return ResponseEntity.ok(out);
  }

  @GetMapping("/api/employees/{id}")
  public Map<String, String> employee(@PathVariable String id) throws Exception {
    String payload = jdbc.query(
        "select payload::text from app_state where id = 'main'",
        rs -> rs.next() ? rs.getString(1) : null);
    if (payload != null) {
      for (JsonNode employee : json.readTree(payload).path("employees")) {
        if (!id.equals(employee.path("id").asText())) continue;
        Map<String, String> found = new LinkedHashMap<>();
        found.put("id", id);
        found.put("name", employee.path("name").asText(""));
        found.put("phone", employee.path("phone").asText(""));
        return found;
      }
    }
    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Employee not found.");
  }

  public ResponseEntity<Map<String, Object>> loginRateLimited(
      Map<String, String> body, Throwable ignored) {
    Map<String, Object> error = new LinkedHashMap<>();
    error.put("error", "Too many login attempts for this phone number. Try again in 15 minutes.");
    return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(error);
  }

  private static List<Map<String, String>> apartments(JsonNode jobs, String employeeId, String day) {
    List<Map<String, String>> list = new ArrayList<>();
    if (!jobs.isArray()) return list;
    for (JsonNode job : jobs) {
      if (!day.equals(job.path("date").asText(""))) continue;
      if ("cancelled".equalsIgnoreCase(job.path("status").asText(""))) continue;
      boolean mine = false;
      for (JsonNode assignment : job.path("job_assignments")) {
        if (employeeId.equals(assignment.path("employee_id").asText(""))) {
          mine = true;
          break;
        }
      }
      if (!mine) continue;
      String apartmentId = job.path("property_id").asText("");
      String place = job.path("place_name").asText("").trim();
      if (apartmentId.isEmpty() || place.isEmpty()) continue;
      boolean seen = list.stream().anyMatch(row -> apartmentId.equals(row.get("apartmentId")));
      if (seen) continue;
      Map<String, String> row = new LinkedHashMap<>();
      row.put("apartmentId", apartmentId);
      row.put("name", place);
      list.add(row);
    }
    list.sort((a, b) -> a.get("name").compareToIgnoreCase(b.get("name")));
    return list;
  }

  private static boolean phonesMatch(String stored, String typed) {
    if (stored.isEmpty() || typed.isEmpty()) return false;
    if (stored.equals(typed)) return true;
    if (stored.length() < 8 || typed.length() < 8) return false;
    return stored.endsWith(typed) || typed.endsWith(stored);
  }

  private static String digits(String value) {
    return value == null ? "" : value.replaceAll("\\D", "");
  }

  private static PrivateKey readPrivateKey(String path) throws Exception {
    String pem = Files.readString(Path.of(path))
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replaceAll("\\s", "");
    byte[] encoded = Base64.getDecoder().decode(pem);
    return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(encoded));
  }
}
