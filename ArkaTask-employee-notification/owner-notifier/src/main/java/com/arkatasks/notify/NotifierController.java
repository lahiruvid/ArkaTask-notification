package com.arkatasks.notify;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class NotifierController {
  private final OwnerNotifier notifier;

  public NotifierController(OwnerNotifier notifier) {
    this.notifier = notifier;
  }

  @GetMapping("/api/notifications/latest")
  public Map<String, String> latest() {
    return notifier.latest();
  }

  @PostMapping("/api/notifications")
  public ResponseEntity<Void> receive(@RequestBody JsonNode body) throws Exception {
    notifier.onClean(body.toString());
    return ResponseEntity.noContent().build();
  }
}
