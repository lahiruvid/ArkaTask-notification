package com.arkatasks.clean;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.X509EncodedKeySpec;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
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
  private final PublicKey publicKey;
  private final ZoneId zone;
  private final OwnerNotifierClient ownerNotifier;

  public CleanEventController(
      JdbcTemplate jdbc,
      KafkaTemplate<String, String> kafka,
      RabbitTemplate rabbit,
      ObjectMapper json,
      @Value("${jwt.public-key-path:/keys/public.pem}") String publicKeyPath,
      @Value("${app.timezone:Europe/Rome}") String timezone,
      OwnerNotifierClient ownerNotifier) throws Exception {
    this.jdbc = jdbc;
    this.kafka = kafka;
    this.rabbit = rabbit;
    this.json = json;
    this.publicKey = readPublicKey(publicKeyPath);
    this.zone = ZoneId.of(timezone);
    this.ownerNotifier = ownerNotifier;
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
  @Transactional
  public Map<String, Object> markClean(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Map<String, String> body) throws Exception {
    Claims claims = verify(authorization);
    String employeeId = claims.getSubject();
    String employeeName = claims.get("name", String.class);
    String employeePhone = claims.get("phone", String.class);
    String apartmentId = body.getOrDefault("apartmentId", "").trim();
    String date = body.getOrDefault("date", "").trim();
    if (apartmentId.isEmpty() || date.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "apartmentId and date are required.");
    }
    String apartmentName = lookupName(apartmentId, date, employeeId);
    String time = LocalTime.now(zone).format(DateTimeFormatter.ofPattern("HH:mm"));
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
  @Transactional
  public void relayPending() throws Exception {
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

  private Claims verify(String authorization) {
    if (authorization == null || !authorization.startsWith("Bearer ")) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Employee login is required.");
    }
    try {
      return Jwts.parser().verifyWith(publicKey).build()
          .parseSignedClaims(authorization.substring(7).trim())
          .getPayload();
    } catch (RuntimeException ex) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Employee login is required.");
    }
  }

  private static PublicKey readPublicKey(String path) throws Exception {
    String pem = Files.readString(Path.of(path))
        .replace("-----BEGIN PUBLIC KEY-----", "")
        .replace("-----END PUBLIC KEY-----", "")
        .replaceAll("\\s", "");
    return KeyFactory.getInstance("RSA")
        .generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(pem)));
  }
}
