package com.arkatasks.notify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.context.annotation.Bean;
import org.springframework.stereotype.Component;

@Component
public class OwnerNotifier {
  static final String QUEUE = "owner-notifications";
  private static final Logger log = LoggerFactory.getLogger(OwnerNotifier.class);
  private final ObjectMapper json;
  private final LoginLookupClient loginLookup;
  private volatile Map<String, String> latest = Map.of();

  public OwnerNotifier(ObjectMapper json, LoginLookupClient loginLookup) {
    this.json = json;
    this.loginLookup = loginLookup;
  }

  @Bean
  Queue ownerNotifications() {
    return new Queue(QUEUE, true);
  }

  @RabbitListener(queues = QUEUE)
  public void onClean(String body) throws Exception {
    JsonNode event = json.readTree(body);
    String lookedUp = loginLookup.phoneFor(event.path("employeeId").asText(""));
    String phone = digits(lookedUp.isEmpty() ? event.path("employeePhone").asText("") : lookedUp);
    String apartment = event.path("apartmentName").asText("");
    String date = event.path("date").asText("");
    String time = event.path("time").asText("");
    String text = "Cleaned: " + apartment + " on " + date + " at " + time;
    String url = phone.isEmpty()
        ? ""
        : "https://wa.me/" + phone + "?text=" + URLEncoder.encode(text, StandardCharsets.UTF_8);
    Map<String, String> notice = new LinkedHashMap<>();
    notice.put("employeePhone", phone);
    notice.put("apartmentName", apartment);
    notice.put("date", date);
    notice.put("time", time);
    notice.put("whatsappUrl", url);
    latest = notice;
    log.info("WhatsApp click-to-chat for {}: {}", phone, url);
  }

  public Map<String, String> latest() {
    return latest;
  }

  private static String digits(String value) {
    return value == null ? "" : value.replaceAll("\\D", "");
  }
}
