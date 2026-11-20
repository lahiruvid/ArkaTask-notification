package com.arkatasks.login;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The two public Supabase values (project URL and anon/publishable key) in one local file,
 * mode 600, owned by the user running this service. Secret or service_role keys are refused.
 * Values are never logged.
 */
public class SupabaseKeysFile {
  public record Creds(String url, String anonKey) {}

  /** The submitted values are not acceptable. Message is safe to return to the client. */
  public static final class RejectedKeys extends RuntimeException {
    public RejectedKeys(String message) {
      super(message);
    }
  }

  private static final Set<PosixFilePermission> FILE_600 = PosixFilePermissions.fromString("rw-------");
  private static final Set<PosixFilePermission> DIR_700 = PosixFilePermissions.fromString("rwx------");

  private final Path path;
  private final String expectedUrl;
  private final ObjectMapper json;

  public SupabaseKeysFile(Path path, String expectedUrl, ObjectMapper json) {
    this.path = path;
    this.expectedUrl = normalizeUrl(expectedUrl);
    this.json = json;
  }

  public Path path() {
    return path;
  }

  /** Checks format and project. Returns the cleaned values. Never logs them. */
  public Creds validate(String url, String anonKey) {
    String cleanUrl = normalizeUrl(url);
    String cleanKey = anonKey == null ? "" : anonKey.replaceAll("\\s", "");
    if (cleanUrl.isEmpty() || cleanKey.isEmpty()) {
      throw new RejectedKeys("Supabase project URL and anon key are required.");
    }
    cleanUrl = requireProjectUrl(cleanUrl);
    if (!expectedUrl.isEmpty() && !expectedUrl.equalsIgnoreCase(cleanUrl)) {
      throw new RejectedKeys("Supabase project URL does not match this server.");
    }
    requirePublicKey(cleanKey);
    return new Creds(cleanUrl, cleanKey);
  }

  /** Validates and writes atomically with mode 600. Skips the write when nothing changed. */
  public synchronized void save(String url, String anonKey) throws IOException {
    Creds valid = validate(url, anonKey);
    String cleanUrl = valid.url();
    String cleanKey = valid.anonKey();
    Creds current = read();
    if (current != null && current.url().equals(cleanUrl) && current.anonKey().equals(cleanKey)) {
      return;
    }
    Path dir = path.toAbsolutePath().getParent();
    if (!Files.isDirectory(dir)) {
      try {
        Files.createDirectories(dir, PosixFilePermissions.asFileAttribute(DIR_700));
      } catch (FileAlreadyExistsException ignored) {
        // created concurrently
      }
    }
    try {
      Files.setPosixFilePermissions(dir, DIR_700);
    } catch (IOException | UnsupportedOperationException | SecurityException ignored) {
      // Not our directory (for example a mount point). The file itself is still 600.
    }
    Map<String, String> body = new LinkedHashMap<>();
    body.put("supabaseUrl", cleanUrl);
    body.put("supabaseAnonKey", cleanKey);
    Path tmp = Files.createTempFile(dir, ".supabase-keys", ".tmp", PosixFilePermissions.asFileAttribute(FILE_600));
    try {
      Files.writeString(tmp, json.writeValueAsString(body), StandardCharsets.UTF_8);
      Files.setPosixFilePermissions(tmp, FILE_600);
      Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    } finally {
      Files.deleteIfExists(tmp);
    }
    Files.setPosixFilePermissions(path, FILE_600);
  }

  /** Saved values, or null when the file is missing or unreadable. */
  public Creds read() {
    try {
      if (!Files.isRegularFile(path)) return null;
      JsonNode node = json.readTree(Files.readString(path, StandardCharsets.UTF_8));
      String url = node.path("supabaseUrl").asText("");
      String key = node.path("supabaseAnonKey").asText("");
      if (url.isEmpty() || key.isEmpty()) return null;
      return new Creds(url, key);
    } catch (IOException ex) {
      return null;
    }
  }

  /** Zero or one entry, for the outbox relay loop. */
  public List<Creds> active() {
    Creds creds = read();
    return creds == null ? List.of() : List.of(creds);
  }

  /** Refuses service_role / secret keys. Accepts legacy anon JWTs and sb_publishable_ keys. */
  static void requirePublicKey(String key) {
    String lower = key.toLowerCase();
    if (lower.startsWith("sb_secret_")) {
      throw new RejectedKeys("A Supabase secret key was sent. Only the anon or publishable key is allowed.");
    }
    if (lower.startsWith("sb_publishable_")) return;
    String[] parts = key.split("\\.");
    if (parts.length != 3) {
      throw new RejectedKeys("The Supabase anon key is not in a known format.");
    }
    String role;
    try {
      JsonNode payload = new ObjectMapper().readTree(Base64.getUrlDecoder().decode(parts[1]));
      role = payload.path("role").asText("");
    } catch (Exception ex) {
      throw new RejectedKeys("The Supabase anon key is not in a known format.");
    }
    if (!"anon".equals(role)) {
      throw new RejectedKeys("Only the Supabase anon key is allowed, never service_role.");
    }
  }

  /** https://&lt;project-ref&gt;.supabase.co with no user, port, or other host. */
  public static String requireProjectUrl(String raw) {
    String value = normalizeUrl(raw);
    if (!value.regionMatches(true, 0, "https://", 0, 8)) {
      throw new RejectedKeys("Supabase project URL must use https.");
    }
    String host = value.substring("https://".length());
    int slash = host.indexOf('/');
    if (slash >= 0) {
      host = host.substring(0, slash);
    }
    if (host.indexOf('@') >= 0 || host.indexOf(':') >= 0
        || !host.matches("(?i)[a-z0-9-]+\\.supabase\\.co")) {
      throw new RejectedKeys("Supabase project URL must be https://<project-ref>.supabase.co");
    }
    return "https://" + host.toLowerCase();
  }

  public static String normalizeUrl(String raw) {
    String value = raw == null ? "" : raw.trim().replaceAll("\\s", "");
    while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
    value = value.replaceAll("(?i)/(rest|auth)/v1.*$", "");
    while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
    return value;
  }
}
