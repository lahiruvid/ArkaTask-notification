package com.arkatasks.e2e;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeFalse;

import io.restassured.http.ContentType;
import io.restassured.response.Response;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

/**
 * Full journey against a running Compose stack.
 * Login is the employee phone login on login-service, reached through Nginx.
 * The DClean owner username login is not this service.
 *
 * Requires app_state to already contain the employee and a job for today.
 * Defaults match the Oracle VM: Nginx on http://127.0.0.1 and owner-notifier on 127.0.0.1:18083.
 * Override with E2E_BASE_URL, E2E_NOTIFIER_URL, and E2E_PHONE.
 *
 * Login needs a real Supabase Auth access token (for example from an anonymous sign-in in the
 * browser) plus the project URL and anon key: E2E_SUPABASE_ACCESS_TOKEN, E2E_SUPABASE_URL,
 * E2E_SUPABASE_ANON_KEY. The test is skipped when they are not set. Never use a service_role key.
 */
class EmployeeCleanJourneyTest {
  private final String baseUrl = env("E2E_BASE_URL", "http://127.0.0.1");
  private final String notifierUrl = env("E2E_NOTIFIER_URL", "http://127.0.0.1:18083");
  private final String phone = env("E2E_PHONE", "+393331112222");
  private final String accessToken = env("E2E_SUPABASE_ACCESS_TOKEN", "");
  private final String supabaseUrl = env("E2E_SUPABASE_URL", "");
  private final String anonKey = env("E2E_SUPABASE_ANON_KEY", "");

  @Test
  @Timeout(120)
  void employeeLoginCleanTapReachesOwnerNotifier() throws InterruptedException {
    assumeFalse(accessToken.isBlank() || supabaseUrl.isBlank() || anonKey.isBlank(),
        "Set E2E_SUPABASE_ACCESS_TOKEN, E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY");
    Response login = given()
        .contentType(ContentType.JSON)
        .header("Authorization", "Bearer " + accessToken)
        .body(Map.of("phone", phone, "supabaseUrl", supabaseUrl, "supabaseAnonKey", anonKey))
        .post(baseUrl + "/api/login")
        .then()
        .statusCode(200)
        .extract()
        .response();

    String token = accessToken;
    String employeeName = login.jsonPath().getString("name");
    String today = login.jsonPath().getString("todayDate");
    List<Map<String, String>> apartments = login.jsonPath().getList("today");
    assertNotNull(apartments);
    assertFalse(apartments.isEmpty(), "employee " + employeeName + " has no apartment for " + today);

    String apartmentId = apartments.get(0).get("apartmentId");
    String apartmentName = apartments.get(0).get("name");

    given()
        .contentType(ContentType.JSON)
        .header("Authorization", "Bearer " + token)
        .body(Map.of("apartmentId", apartmentId, "date", today))
        .post(baseUrl + "/api/cleans")
        .then()
        .statusCode(200);

    Response notice = waitForNotice(apartmentName);
    notice.then().statusCode(200);
    String url = notice.jsonPath().getString("whatsappUrl");
    assertTrue(url != null && url.contains("wa.me"), "owner-notifier did not build a WhatsApp URL");
    assertTrue(url.contains(apartmentName.replace(" ", "+")) || url.contains(apartmentName.replace(" ", "%20")),
        "WhatsApp URL did not include " + apartmentName + ": " + url);
  }

  private Response waitForNotice(String apartmentName) throws InterruptedException {
    Response latest = null;
    long deadline = System.nanoTime() + Duration.ofSeconds(90).toNanos();
    while (System.nanoTime() < deadline) {
      latest = given().get(notifierUrl + "/api/notifications/latest");
      if (latest.statusCode() == 200) {
        String seen = latest.jsonPath().getString("apartmentName");
        if (apartmentName.equals(seen)) {
          return latest;
        }
      }
      Thread.sleep(1000);
    }
    return latest == null
        ? given().get(notifierUrl + "/api/notifications/latest")
        : latest;
  }

  private static String env(String name, String fallback) {
    String value = System.getenv(name);
    return value == null || value.isBlank() ? fallback : value;
  }
}
