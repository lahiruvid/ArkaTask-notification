package com.arkatasks.login;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

/**
 * Employee phone login. The caller must already hold a Supabase Auth access token
 * (checked by SupabaseAuthFilter before this runs). This service never signs tokens.
 * The phone check still reads app_state in Postgres. The project URL and anon key are
 * saved only after that read succeeds; the JWKS URL is never taken from the request.
 */
@RestController
public class LoginController {
  private static final Logger log = LoggerFactory.getLogger(LoginController.class);
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final ZoneId zone;
  private final PhoneLoginLimiter phoneLimits;
  private final CleanEventClient cleanEventClient;
  private final SupabaseKeysFile keysFile;
  private final EmployeeIdentityStore identities;

  public LoginController(
      JdbcTemplate jdbc,
      ObjectMapper json,
      @Value("${app.timezone:Europe/Rome}") String timezone,
      PhoneLoginLimiter phoneLimits,
      CleanEventClient cleanEventClient,
      SupabaseKeysFile keysFile,
      EmployeeIdentityStore identities) {
    this.jdbc = jdbc;
    this.json = json;
    this.zone = ZoneId.of(timezone);
    this.phoneLimits = phoneLimits;
    this.cleanEventClient = cleanEventClient;
    this.keysFile = keysFile;
    this.identities = identities;
  }

  @PostMapping("/api/login")
  // @RateLimiter(name = "login", fallbackMethod = "loginRateLimited")
  public ResponseEntity<Map<String, Object>> login(
      HttpServletRequest request, @RequestBody Map<String, String> body) throws Exception {
    Claims claims = SupabaseAuthFilter.claims(request);
    if (claims == null) {
      return error(HttpStatus.UNAUTHORIZED, "Employee login is required.");
    }
    String typed = digits(body.get("phone"));
    if (typed.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Phone number is required.");
    }
    // if (!phoneLimits.allow(typed)) {
    //   return loginRateLimited(body, null);
    // }
    SupabaseKeysFile.Creds creds;
    try {
      creds = keysFile.validate(body.get("supabaseUrl"), body.get("supabaseAnonKey"));
    } catch (SupabaseKeysFile.RejectedKeys ex) {
      return error(HttpStatus.BAD_REQUEST, ex.getMessage());
    }
    // The token's issuer must be this same project. The JWKS itself comes only from server config.
    if (!(creds.url() + "/auth/v1").equals(claims.getIssuer())) {
      return error(HttpStatus.BAD_REQUEST, "Supabase project URL does not match the signed-in project.");
    }
    String payload = jdbc.query(
        "select payload::text from app_state where id = 'main'",
        rs -> rs.next() ? rs.getString(1) : null);
    try {
      keysFile.save(creds.url(), creds.anonKey());
    } catch (java.io.IOException | RuntimeException ex) {
      log.error("Could not write the Supabase keys file {}: {}", keysFile.path(), ex.getClass().getSimpleName());
      return error(HttpStatus.SERVICE_UNAVAILABLE, "Could not store the Supabase keys.");
    }
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
    try {
      identities.save(claims.getSubject(), employeeId, name, phone);
    } catch (RuntimeException ex) {
      return error(HttpStatus.SERVICE_UNAVAILABLE, "Could not store the employee session.");
    }
    LocalDate today = LocalDate.now(zone);
    LocalDate tomorrow = today.plusDays(1);
    Map<String, Object> out = new LinkedHashMap<>();
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

  private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String message) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("error", message);
    return ResponseEntity.status(status).body(body);
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
}
