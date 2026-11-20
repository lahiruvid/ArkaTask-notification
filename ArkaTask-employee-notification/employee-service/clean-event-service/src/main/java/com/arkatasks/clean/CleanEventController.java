package com.arkatasks.clean;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class CleanEventController {
  static final String QUEUE = "owner-notifications";
  static final String TOPIC = "clean-events";

  private final JdbcTemplate jdbc;
  private final KafkaTemplate<String, String> kafka;
  private final RabbitTemplate rabbit;
  private final ObjectMapper json;
  private final ZoneId zone;
  private final OwnerNotifierClient ownerNotifier;
  private final EmployeeIdentityStore identities;
  private final SupabaseKeysFile keys;
  private final HttpClient http = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(5))
      .followRedirects(HttpClient.Redirect.NEVER)
      .build();

  /** Tests pass a JDBC mock. Production has no DataSource, so jdbc is null. */
  public CleanEventController(
      JdbcTemplate jdbc,
      KafkaTemplate<String, String> kafka,
      RabbitTemplate rabbit,
      ObjectMapper json,
      @Value("${app.timezone:Europe/Rome}") String timezone,
      OwnerNotifierClient ownerNotifier,
      EmployeeIdentityStore identities) {
    this(jdbc, kafka, rabbit, json, timezone, ownerNotifier, identities, null);
  }

  @Autowired
  public CleanEventController(
      ObjectProvider<JdbcTemplate> jdbc,
      KafkaTemplate<String, String> kafka,
      RabbitTemplate rabbit,
      ObjectMapper json,
      @Value("${app.timezone:Europe/Rome}") String timezone,
      OwnerNotifierClient ownerNotifier,
      EmployeeIdentityStore identities,
      SupabaseKeysFile keys) {
    this(jdbc.getIfAvailable(), kafka, rabbit, json, timezone, ownerNotifier, identities, keys);
  }

  private CleanEventController(
      JdbcTemplate jdbc,
      KafkaTemplate<String, String> kafka,
      RabbitTemplate rabbit,
      ObjectMapper json,
      String timezone,
      OwnerNotifierClient ownerNotifier,
      EmployeeIdentityStore identities,
      SupabaseKeysFile keys) {
    this.jdbc = jdbc;
    this.kafka = kafka;
    this.rabbit = rabbit;
    this.json = json;
    this.zone = ZoneId.of(timezone);
    this.ownerNotifier = ownerNotifier;
    this.identities = identities;
    this.keys = keys;
  }

  @PostMapping("/api/employee-logins")
  public ResponseEntity<Void> employeeLogin(@RequestBody Map<String, String> body) {
    String employeeId = body.get("employeeId");
    if (employeeId == null || employeeId.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "employeeId is required.");
    }
    return ResponseEntity.noContent().build();
  }

  @PostMapping("/api/cleans")
  public Map<String, Object> markClean(
      HttpServletRequest request,
      @RequestBody Map<String, String> body) throws Exception {
    // SupabaseAuthFilter already verified the Supabase access token for /api/cleans.
    Claims claims = SupabaseAuthFilter.claims(request);
    if (claims == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Employee login is required.");
    }
    EmployeeIdentityStore.Employee employee = identities.find(claims.getSubject());
    if (employee == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Employee session expired. Sign in again.");
    }
    String employeeId = employee.employeeId();
    String employeeName = employee.name();
    String employeePhone = employee.phone();
    String apartmentId = body.getOrDefault("apartmentId", "").trim();
    String date = body.getOrDefault("date", "").trim();
    if (apartmentId.isEmpty() || date.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "apartmentId and date are required.");
    }
    String apartmentName = lookupName(apartmentId, date, employeeId);
    String time = LocalTime.now(zone).format(DateTimeFormatter.ofPattern("HH:mm"));
    if (jdbc == null) {
      Map<String, Object> event = event(apartmentId, apartmentName, date, time, employeeId, employeeName, employeePhone);
      kafka.send(TOPIC, employeeId + ":" + apartmentId + ":" + date, json.writeValueAsString(event));
      return Map.of(
          "status", "accepted",
          "outbox", "skipped",
          "apartmentId", apartmentId,
          "date", date);
    }
    int inserted = jdbc.update(
        "insert into clean_outbox (apartment_id, date, employee_id, employee_name, employee_phone, apartment_name, clean_time, status) "
            + "values (?, ?::date, ?, ?, ?, ?, ?, 'PENDING') on conflict do nothing",
        apartmentId, date, employeeId, employeeName == null ? "" : employeeName,
        employeePhone, apartmentName, time);
    Map<String, Object> event = event(apartmentId, apartmentName, date, time, employeeId, employeeName, employeePhone);
    if (inserted == 0) {
      return Map.of("status", "already-recorded", "apartmentId", apartmentId, "date", date);
    }
    kafka.send(TOPIC, employeeId + ":" + apartmentId + ":" + date, json.writeValueAsString(event));
    return Map.of("status", "accepted", "apartmentId", apartmentId, "date", date);
  }

  @Scheduled(fixedDelay = 5000)
  public void relayPending() throws Exception {
    if (jdbc == null) {
      return;
    }
    List<Map<String, Object>> rows = jdbc.queryForList(
        "select apartment_id, date::text as date, employee_id, employee_name, employee_phone, apartment_name, clean_time "
            + "from clean_outbox where status = 'PENDING' order by created_at limit 20 for update skip locked");
    for (Map<String, Object> row : rows) {
      Map<String, Object> event = event(
          String.valueOf(row.get("apartment_id")),
          String.valueOf(row.get("apartment_name")),
          String.valueOf(row.get("date")),
          String.valueOf(row.get("clean_time")),
          String.valueOf(row.get("employee_id")),
          String.valueOf(row.get("employee_name")),
          row.get("employee_phone") == null ? "" : String.valueOf(row.get("employee_phone")));
      String payloadJson = json.writeValueAsString(event);
      rabbit.convertAndSend(QUEUE, payloadJson);
      ownerNotifier.deliver(payloadJson);
      jdbc.update(
          "update clean_outbox set status = 'RELAYED', relayed_at = now() "
              + "where apartment_id = ? and date = ?::date and employee_id = ?",
          row.get("apartment_id"), row.get("date"), row.get("employee_id"));
    }
  }

  private String lookupName(String apartmentId, String date, String employeeId) throws Exception {
    if (jdbc == null) {
      return lookupNameFromSupabase(apartmentId, date, employeeId);
    }
    String payload = jdbc.query(
        "select payload::text from app_state where id = 'main'",
        rs -> rs.next() ? rs.getString(1) : null);
    if (payload == null) return apartmentId;
    var jobs = json.readTree(payload).path("jobs");
    if (!jobs.isArray()) return apartmentId;
    for (var job : jobs) {
      if (!apartmentId.equals(job.path("property_id").asText())) continue;
      if (!date.equals(job.path("date").asText())) continue;
      for (var assignment : job.path("job_assignments")) {
        if (employeeId.equals(assignment.path("employee_id").asText())) {
          String name = job.path("place_name").asText("").trim();
          return name.isEmpty() ? apartmentId : name;
        }
      }
    }
    return apartmentId;
  }

  /** app_state via PostgREST using the URL and anon key login-service saved. The key is not logged. */
  private String lookupNameFromSupabase(String apartmentId, String date, String employeeId) throws Exception {
    if (keys == null) return apartmentId;
    SupabaseKeysFile.Creds creds = keys.read();
    if (creds == null) return apartmentId;
    SupabaseKeysFile.requirePublicKey(creds.anonKey());
    URI uri = URI.create(SupabaseKeysFile.normalizeUrl(creds.url()) + "/rest/v1/app_state?id=eq.main&select=payload");
    HttpRequest request = HttpRequest.newBuilder(uri)
        .timeout(Duration.ofSeconds(10))
        .header("apikey", creds.anonKey())
        .header("Authorization", "Bearer " + creds.anonKey())
        .header("Accept", "application/json")
        .GET()
        .build();
    HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
    if (response.statusCode() != 200 || response.body() == null || response.body().isBlank()) {
      return apartmentId;
    }
    var root = json.readTree(response.body());
    var row = root.isArray() && !root.isEmpty() ? root.get(0) : root;
    var jobs = row.path("payload").path("jobs");
    if (row.path("payload").isTextual()) {
      jobs = json.readTree(row.path("payload").asText()).path("jobs");
    }
    if (!jobs.isArray()) return apartmentId;
    for (var job : jobs) {
      if (!apartmentId.equals(job.path("property_id").asText())) continue;
      if (!date.equals(job.path("date").asText())) continue;
      for (var assignment : job.path("job_assignments")) {
        if (employeeId.equals(assignment.path("employee_id").asText())) {
          String name = job.path("place_name").asText("").trim();
          return name.isEmpty() ? apartmentId : name;
        }
      }
    }
    return apartmentId;
  }

  private static Map<String, Object> event(
      String apartmentId, String apartmentName, String date, String time,
      String employeeId, String employeeName, String employeePhone) {
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("apartmentId", apartmentId);
    event.put("apartmentName", apartmentName);
    event.put("date", date);
    event.put("time", time);
    event.put("employeeId", employeeId);
    event.put("employeeName", employeeName);
    event.put("employeePhone", employeePhone);
    return event;
  }
}
