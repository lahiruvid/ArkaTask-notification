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
import re
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


class StackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        wait_for_login()

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

    def test_08_zipkin_health(self):
        status, _, raw = request("GET", ZIPKIN + "/health")
        self.assertEqual(status, 200, raw[:200])
        self.assertIn(b"UP", raw)


if __name__ == "__main__":
    unittest.main(verbosity=2)
