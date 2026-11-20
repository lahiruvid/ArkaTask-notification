package com.arkatasks.clean;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Employee clean tap. SupabaseAuthFilter has already verified the Supabase access token.
 * The event goes to Kafka first and the request waits for the broker's ack. CleanOutbox then
 * writes it to the Supabase clean_outbox table and relays it to RabbitMQ.
 */
@RestController
public class CleanEventController {
  private static final Logger log = LoggerFactory.getLogger(CleanEventController.class);
  private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

  private final KafkaTemplate<String, String> kafka;
  private final ObjectMapper json;
  private final ZoneId zone;
  private final EmployeeIdentityStore identities;
  private final SupabaseKeysFile keys;
  private final SupabaseRest supabase;

  public CleanEventController(
      KafkaTemplate<String, String> kafka,
      ObjectMapper json,
      @Value("${app.timezone:Europe/Rome}") String timezone,
      EmployeeIdentityStore identities,
      SupabaseKeysFile keys,
      SupabaseRest supabase) {
    this.kafka = kafka;
    this.json = json;
    this.zone = ZoneId.of(timezone);
    this.identities = identities;
    this.keys = keys;
    this.supabase = supabase;
  }

  @PostMapping("/api/cleans")
  public Map<String, Object> markClean(HttpServletRequest request, @RequestBody Map<String, String> body)
      throws Exception {
    Claims claims = SupabaseAuthFilter.claims(request);
    if (claims == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Employee login is required.");
    }
    EmployeeIdentityStore.Employee employee = identities.find(claims.getSubject());
    if (employee == null) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Employee session expired. Sign in again.");
    }
    String apartmentId = trimmed(body.get("apartmentId"));
    String date = trimmed(body.get("date"));
    if (apartmentId.isEmpty() || date.isEmpty()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "apartmentId and date are required.");
    }
    try {
      LocalDate.parse(date);
    } catch (DateTimeParseException ex) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "date must be YYYY-MM-DD.");
    }

    // Best effort: a Supabase outage must not lose the tap, because Kafka holds it until the
    // outbox write succeeds. Without Supabase the apartment id stands in for its name.
    String apartmentName = apartmentId;
    SupabaseKeysFile.Creds creds = keys.read();
    if (creds != null) {
      try {
        if (supabase.outboxHas(creds, apartmentId, date, employee.employeeId())) {
          return Map.of("status", "already-recorded", "apartmentId", apartmentId, "date", date);
        }
        apartmentName = supabase.apartmentName(creds, apartmentId, date, employee.employeeId());
      } catch (SupabaseRest.Unavailable ex) {
        log.warn("Supabase lookup failed, recording the tap anyway: {}", ex.getMessage());
      }
    }

    CleanEvent event = new CleanEvent(
        apartmentId,
        apartmentName,
        date,
        LocalTime.now(zone).format(HH_MM),
        employee.employeeId(),
        employee.name(),
        employee.phone());
    try {
      kafka.send(MessagingConfig.TOPIC, CleanEvent.keyOf(event), json.writeValueAsString(event))
          .get(10, TimeUnit.SECONDS);
    } catch (InterruptedException ex) {
      Thread.currentThread().interrupt();
      throw unavailable(ex);
    } catch (ExecutionException | TimeoutException | RuntimeException ex) {
      throw unavailable(ex);
    }
    return Map.of("status", "accepted", "apartmentId", apartmentId, "date", date);
  }

  private static ResponseStatusException unavailable(Exception ex) {
    log.error("Kafka did not accept the clean event: {}", ex.getClass().getSimpleName());
    return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Could not record the clean. Try again.");
  }

  private static String trimmed(String value) {
    return value == null ? "" : value.trim();
  }
}
