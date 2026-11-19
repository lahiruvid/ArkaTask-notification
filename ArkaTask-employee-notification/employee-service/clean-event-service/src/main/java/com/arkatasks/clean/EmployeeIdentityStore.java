package com.arkatasks.clean;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Links a Supabase Auth user id (the token's sub) to the employee found by the phone check.
 * This is not a token store: tokens are self-contained and never saved. Rows expire after 12 hours,
 * the same lifetime the old service-signed token had, so employees sign in again each day.
 */
@Component
public class EmployeeIdentityStore {
  public record Employee(String employeeId, String name, String phone) {}

  private final JdbcTemplate jdbc;

  public EmployeeIdentityStore(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
    jdbc.execute(
        "create table if not exists employee_login ("
            + "auth_uid text primary key, employee_id text not null, name text not null default '', "
            + "phone text not null default '', created_at timestamptz not null default now())");
  }

  public void save(String authUid, String employeeId, String name, String phone) {
    forgetExpired();
    jdbc.update(
        "insert into employee_login (auth_uid, employee_id, name, phone) values (?, ?, ?, ?) "
            + "on conflict (auth_uid) do update set employee_id = excluded.employee_id, "
            + "name = excluded.name, phone = excluded.phone, created_at = now()",
        authUid, employeeId, name == null ? "" : name, phone == null ? "" : phone);
  }

  public Employee find(String authUid) {
    if (authUid == null || authUid.isBlank()) return null;
    forgetExpired();
    return jdbc.query(
        "select employee_id, name, phone from employee_login where auth_uid = ?",
        rs -> rs.next() ? new Employee(rs.getString(1), rs.getString(2), rs.getString(3)) : null,
        authUid);
  }

  private void forgetExpired() {
    jdbc.update("delete from employee_login where created_at < now() - interval '12 hours'");
  }
}
