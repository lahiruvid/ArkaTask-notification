#!/usr/bin/env python3
"""HTTP checks against a running ArkaTasks stack, through Nginx.

Run after docker compose up:
  python3 e2e/test_stack.py

Env:
  E2E_BASE_URL   default http://127.0.0.1:80
  E2E_ZIPKIN_URL default http://127.0.0.1:9411
"""

import json
import os
import time
import unittest
import urllib.error
import urllib.request

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:80").rstrip("/")
ZIPKIN = os.environ.get("E2E_ZIPKIN_URL", "http://127.0.0.1:9411").rstrip("/")


def wait_for_login():
    grace = int(os.environ.get("E2E_GRACE_SECONDS", "15"))
    timeout = int(os.environ.get("E2E_READY_TIMEOUT", "180"))
    print("Waiting %s seconds before checking login-service" % grace, flush=True)
    time.sleep(grace)
    deadline = time.time() + timeout
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        try:
            health_status, _, health_body = request("GET", BASE + "/actuator/health", timeout=5)
        except Exception as exc:
            health_status, health_body = 0, str(exc).encode()
        print("login ready attempt %s: /actuator/health HTTP %s" % (attempt, health_status), flush=True)
        if health_status == 200 and b"UP" in health_body:
            return
        try:
            status, _, _ = request("POST", BASE + "/api/login", {"phone": "0"}, timeout=5)
        except Exception as exc:
            print("login ready attempt %s: /api/login %s" % (attempt, exc), flush=True)
            time.sleep(5)
            continue
        print("login ready attempt %s: /api/login HTTP %s" % (attempt, status), flush=True)
        if status not in (502, 503, 504):
            return
        time.sleep(5)
    raise RuntimeError("login-service did not answer through Nginx within %s seconds" % timeout)


def request(method, url, body=None, headers=None, timeout=20):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
            return res.status, dict(res.headers), raw
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()


def app_error(status, raw):
    """True when the answer came from a Spring service (JSON error), not from Nginx."""
    try:
        return status in (400, 401, 429, 503) and "error" in json.loads(raw)
    except ValueError:
        return False


class StackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        wait_for_login()

    def test_01_login_health_through_nginx(self):
        status, _, raw = request("GET", BASE + "/actuator/health")
        self.assertEqual(status, 200, raw[:300])
        self.assertIn(b"UP", raw)

    def test_02_login_endpoint_is_proxied(self):
        # No token: login-service answers 401, or 503 before any Supabase project is known.
        status, _, raw = request("POST", BASE + "/api/login", {"phone": "0"})
        self.assertTrue(app_error(status, raw), "%s %s" % (status, raw[:300]))

    def test_03_clean_endpoint_is_proxied(self):
        status, _, raw = request("POST", BASE + "/api/cleans", {"apartmentId": "a", "date": "2026-01-01"})
        self.assertTrue(app_error(status, raw), "%s %s" % (status, raw[:300]))

    def test_04_cors_preflight(self):
        status, headers, _ = request("OPTIONS", BASE + "/api/cleans", headers={
            "Origin": "https://example.pages.dev",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        self.assertEqual(status, 204)
        self.assertTrue(headers.get("Access-Control-Allow-Origin"))
        self.assertIn("Authorization", headers.get("Access-Control-Allow-Headers", ""))

    def test_05_internal_endpoints_are_not_public(self):
        for path in ("/api/notifications/latest", "/api/employees/e1", "/actuator/metrics", "/api/employee-logins"):
            status, _, _ = request("GET", BASE + path)
            self.assertEqual(status, 404, path)

    def test_08_zipkin_health(self):
        status, _, raw = request("GET", ZIPKIN + "/health")
        self.assertEqual(status, 200, raw[:200])
        self.assertIn(b"UP", raw)


if __name__ == "__main__":
    unittest.main(verbosity=2)
