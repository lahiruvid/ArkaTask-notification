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
import java.util.Map;
import java.util.Set;

/**
 * The two public Supabase values (project URL and anon/publishable key).
 *
 * <p>They come from the server config (SUPABASE_URL and SUPABASE_ANON_KEY) when those are set,
 * and from one local file, mode 600, that login-service writes after a verified employee login.
 * When SUPABASE_URL is set, the file can only hold that project. Secret or service_role keys are
 * refused everywhere. Values are never logged.
 *
 * <p>Kept identical in login-service and clean-event-service apart from the package name.
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
  private final Creds configured;
  private final ObjectMapper json;

  public SupabaseKeysFile(Path path, String expectedUrl, ObjectMapper json) {
    this(path, expectedUrl, "", json);
  }

  /**
   * @param configuredUrl SUPABASE_URL, or empty. When set, only this project is accepted.
   * @param configuredAnonKey SUPABASE_ANON_KEY, or empty. Used until a login saves the file.
   */
  public SupabaseKeysFile(Path path, String configuredUrl, String configuredAnonKey, ObjectMapper json) {
    this.path = path;
    this.expectedUrl = normalizeUrl(configuredUrl);
    this.json = json;
    this.configured = fromConfig(this.expectedUrl, configuredAnonKey);
  }

  public Path path() {
    return path;
  }

  /** The project URL pinned by server config, or empty when the server accepts the first login's project. */
  public String expectedUrl() {
    return expectedUrl;
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
    Creds current = readFile();
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

  /**
   * Values saved by the last verified login, else the server config, else null.
   * A saved file for another project than SUPABASE_URL is ignored.
   */
  public Creds read() {
    Creds saved = readFile();
    if (saved != null && (expectedUrl.isEmpty() || expectedUrl.equalsIgnoreCase(normalizeUrl(saved.url())))) {
      return saved;
    }
    return configured;
  }

  private Creds readFile() {
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

  private static Creds fromConfig(String url, String anonKey) {
    String key = anonKey == null ? "" : anonKey.replaceAll("\\s", "");
    if (url.isEmpty() || key.isEmpty()) return null;
    try {
      requirePublicKey(key);
      return new Creds(requireProjectUrl(url), key);
    } catch (RejectedKeys ex) {
      throw new IllegalStateException("SUPABASE_URL and SUPABASE_ANON_KEY must be the public project URL "
          + "and the anon or publishable key: " + ex.getMessage());
    }
  }

  /**
   * Headers for Supabase REST with a public key. A legacy anon JWT also goes in Authorization;
   * an sb_publishable_ key is sent as apikey only, because it is not a JWT.
   */
  public static Map<String, String> authHeaders(String key) {
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("apikey", key);
    if (key.split("\\.").length == 3) {
      headers.put("Authorization", "Bearer " + key);
    }
    return headers;
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
