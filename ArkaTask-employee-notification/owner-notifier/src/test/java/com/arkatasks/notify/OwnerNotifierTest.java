package com.arkatasks.notify;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class OwnerNotifierTest {
  static final String EVENT = "{\"apartmentId\":\"a1\",\"apartmentName\":\"Via Roma\",\"date\":\"2026-11-20\","
      + "\"time\":\"10:00\",\"employeeId\":\"e1\",\"employeeName\":\"Ana\",\"employeePhone\":\"+39 333 111\"}";

  @Test
  void buildsWhatsAppLinkFromTheLookedUpPhone() throws Exception {
    LoginLookupClient lookup = mock(LoginLookupClient.class);
    when(lookup.phoneFor("e1")).thenReturn("+39 333 999");
    OwnerNotifier notifier = new OwnerNotifier(new ObjectMapper(), lookup);
    notifier.onClean(EVENT);
    String url = notifier.latest().get("whatsappUrl");
    assertTrue(url.startsWith("https://wa.me/39333999?text="), url);
    assertTrue(url.contains("Via+Roma"), url);
  }

  @Test
  void fallsBackToThePhoneInTheEvent() throws Exception {
    LoginLookupClient lookup = mock(LoginLookupClient.class);
    when(lookup.phoneFor("e1")).thenReturn("");
    OwnerNotifier notifier = new OwnerNotifier(new ObjectMapper(), lookup);
    notifier.onClean(EVENT);
    assertEquals("39333111", notifier.latest().get("employeePhone"));
  }
}
