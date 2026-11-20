package com.arkatasks.clean;

/**
 * One clean tap. The same JSON shape goes to Kafka, into the Supabase clean_outbox row,
 * and to RabbitMQ for owner-notifier.
 */
public record CleanEvent(
    String apartmentId,
    String apartmentName,
    String date,
    String time,
    String employeeId,
    String employeeName,
    String employeePhone) {

  /** Kafka key: one partition order per employee, apartment, and day. */
  static String keyOf(CleanEvent event) {
    return event.employeeId() + ":" + event.apartmentId() + ":" + event.date();
  }
}
