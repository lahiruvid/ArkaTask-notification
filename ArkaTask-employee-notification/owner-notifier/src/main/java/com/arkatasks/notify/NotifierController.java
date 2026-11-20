package com.arkatasks.notify;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Last WhatsApp notice, for operators and the E2E test on the VM (127.0.0.1:18083).
 * Nginx does not publish it: the notice holds a phone number.
 */
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
}
