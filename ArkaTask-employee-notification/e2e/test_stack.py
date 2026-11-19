#!/usr/bin/env python3
"""HTTP checks against a running ArkaTasks stack, through Nginx.

Run after docker compose up:
  python3 e2e/test_stack.py

Env:
  E2E_BASE_URL   default http://127.0.0.1:8880
  E2E_ZIPKIN_URL default http://127.0.0.1:9411
  E2E_PHONE      employee phone already stored in app_state
"""

import json
import os
import re
import time
import unittest
import urllib.error
import urllib.request

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:8880").rstrip("/")
ZIPKIN = os.environ.get("E2E_ZIPKIN_URL", "http://127.0.0.1:9411").rstrip("/")
PHONE = os.environ.get("E2E_PHONE", "+393331112222")


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


class StackTests(unittest.TestCase):
    token = None
    employee_id = None
    today = None
    apartment_id = None
    apartment_name = None

    def test_01_nginx_page_loads(self):
        status, headers, raw = request("GET", BASE + "/")
        self.assertEqual(status, 200, raw[:300])
        ctype = headers.get("Content-Type", headers.get("content-type", ""))
        self.assertIn("text/html", ctype)
        self.assertIn(b"<html", raw.lower())

    def test_02_frontend_asset_loads(self):
        status, _, raw = request("GET", BASE + "/")
        self.assertEqual(status, 200)
        html = raw.decode("utf-8", "replace")
        match = re.search(r'(?:src|href)="([^"]+\.(?:js|css))"', html)
        self.assertIsNotNone(match, "home page did not link a js or css asset")
        path = match.group(1)
        if path.startswith("http"):
            url = path
        elif path.startswith("/"):
            url = BASE + path
        else:
            url = BASE + "/" + path
        asset_status, asset_headers, asset = request("GET", url)
        self.assertEqual(asset_status, 200, path)
        self.assertGreater(len(asset), 0)
        ctype = asset_headers.get("Content-Type", "")
        self.assertTrue("javascript" in ctype or "css" in ctype or "text/" in ctype)

    def test_03_phone_login_returns_schedule(self):
        status, _, raw = request("POST", BASE + "/api/login", {"phone": PHONE})
        self.assertEqual(status, 200, raw[:400])
        body = json.loads(raw)
        self.assertTrue(body.get("token"))
        self.assertTrue(body.get("employeeId"))
        self.assertIsInstance(body.get("today"), list)
        self.assertTrue(body["today"], "no apartment scheduled for today")
        type(self).token = body["token"]
        type(self).employee_id = body["employeeId"]
        type(self).today = body["todayDate"]
        type(self).apartment_id = body["today"][0]["apartmentId"]
        type(self).apartment_name = body["today"][0]["name"]

    def test_04_employee_lookup(self):
        self.assertIsNotNone(self.employee_id, "login did not run")
        status, _, raw = request("GET", BASE + "/api/employees/" + self.employee_id)
        self.assertEqual(status, 200, raw[:300])
        body = json.loads(raw)
        self.assertEqual(body.get("id"), self.employee_id)

    def test_05_employee_login_event(self):
        self.assertIsNotNone(self.employee_id, "login did not run")
        status, _, raw = request(
            "POST",
            BASE + "/api/employee-logins",
            {"employeeId": self.employee_id},
        )
        self.assertEqual(status, 204, raw[:300])

    def test_06_done_tap_is_stored(self):
        self.assertIsNotNone(self.token, "login did not run")
        headers = {"Authorization": "Bearer " + self.token}
        payload = {"apartmentId": self.apartment_id, "date": self.today}
        status, _, raw = request("POST", BASE + "/api/cleans", payload, headers)
        self.assertEqual(status, 200, raw[:300])
        first = json.loads(raw)
        self.assertIn(first.get("status"), ("accepted", "already-recorded"))
        status, _, raw = request("POST", BASE + "/api/cleans", payload, headers)
        self.assertEqual(status, 200, raw[:300])
        second = json.loads(raw)
        self.assertEqual(second.get("status"), "already-recorded")

    def test_07_owner_notification_arrives(self):
        self.assertIsNotNone(self.apartment_name, "login did not run")
        deadline = time.time() + 25
        last = b""
        while time.time() < deadline:
            status, _, raw = request("GET", BASE + "/api/notifications/latest")
            last = raw
            if status == 200:
                body = json.loads(raw or b"{}")
                if body.get("apartmentName") == self.apartment_name and "wa.me" in body.get("whatsappUrl", ""):
                    return
            time.sleep(2)
        self.fail("owner notification did not arrive: " + last[:300].decode("utf-8", "replace"))

    def test_08_zipkin_health(self):
        status, _, raw = request("GET", ZIPKIN + "/health")
        self.assertEqual(status, 200, raw[:200])
        self.assertIn(b"UP", raw)


if __name__ == "__main__":
    unittest.main(verbosity=2)
