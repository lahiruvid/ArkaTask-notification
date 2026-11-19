package com.arkatasks.login;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SupabaseKeysFileTest {
  static final String URL = "https://testref.supabase.co";

  static String fakeJwt(String role) {
    var enc = Base64.getUrlEncoder().withoutPadding();
    return enc.encodeToString("{\"alg\":\"HS256\"}".getBytes(StandardCharsets.UTF_8)) + "."
        + enc.encodeToString(("{\"iss\":\"supabase\",\"ref\":\"testref\",\"role\":\"" + role + "\"}")
            .getBytes(StandardCharsets.UTF_8)) + ".sig";
  }

  @TempDir
  Path dir;

  SupabaseKeysFile file() {
    return new SupabaseKeysFile(dir.resolve("arkatasks/supabase-keys.json"), URL, new ObjectMapper());
  }

  @Test
  void savesWithMode600AndDirectory700() throws Exception {
    var f = file();
    f.save(URL + "/", fakeJwt("anon"));
    assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(f.path())));
    assertEquals("rwx------", PosixFilePermissions.toString(Files.getPosixFilePermissions(f.path().getParent())));
    assertEquals(URL, f.read().url());
    assertEquals(fakeJwt("anon"), f.read().anonKey());
    assertEquals(1, f.active().size());
  }

  @Test
  void replaceKeepsMode600AndLeavesNoTempFiles() throws Exception {
    var f = file();
    f.save(URL, fakeJwt("anon"));
    f.save(URL, "sb_publishable_abcdefghijklmnopqrstuvwxyz");
    assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(f.path())));
    assertEquals("sb_publishable_abcdefghijklmnopqrstuvwxyz", f.read().anonKey());
    try (var list = Files.list(f.path().getParent())) {
      assertEquals(1, list.count());
    }
  }

  @Test
  void refusesServiceRoleAndSecretKeys() {
    var f = file();
    assertThrows(SupabaseKeysFile.RejectedKeys.class, () -> f.save(URL, fakeJwt("service_role")));
    assertThrows(SupabaseKeysFile.RejectedKeys.class, () -> f.save(URL, "sb_secret_abcdefghijklmnopqrstuvwxyz"));
    assertThrows(SupabaseKeysFile.RejectedKeys.class, () -> f.save(URL, "random-garbage-value-123456"));
    assertFalse(Files.exists(f.path()));
  }

  @Test
  void refusesOtherProjectsAndPlainHttp() {
    var f = file();
    assertThrows(SupabaseKeysFile.RejectedKeys.class, () -> f.save("https://other.supabase.co", fakeJwt("anon")));
    var open = new SupabaseKeysFile(dir.resolve("k.json"), "", new ObjectMapper());
    assertThrows(SupabaseKeysFile.RejectedKeys.class, () -> open.save("http://testref.supabase.co", fakeJwt("anon")));
    assertThrows(SupabaseKeysFile.RejectedKeys.class, () -> f.save("", ""));
  }

  @Test
  void missingFileReadsNull() {
    assertNull(file().read());
    assertEquals(0, file().active().size());
  }

  @Test
  void normalizesPastedUrls() {
    assertEquals(URL, SupabaseKeysFile.normalizeUrl(" " + URL + "/rest/v1/ "));
    assertEquals(URL, SupabaseKeysFile.normalizeUrl(URL + "/auth/v1"));
  }
}
