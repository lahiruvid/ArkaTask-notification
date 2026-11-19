# QA log — 19 November 2026

## Login rate limits disabled for testing

- Issue: Even after raising the limits, the test phone still received HTTP 429 from the already-running service.
- Root cause: The limit is kept in memory. A new config does not clear a phone that is already blocked, and the fallback text still says 15 minutes.
- Fix: The per-phone check in `PhoneLoginLimiter` and the `@RateLimiter` annotation on `POST /api/login` are commented out. The YAML values are set to 100000 per second and are not enforced.
- Status: Changed locally. Not pushed. Restore both checks before production use.

## E2E started before login-service was ready

- Issue: Deploy run 44566333807 failed. Nginx returned 502 on phone login.
- Root cause: The test suite called login-service a few seconds after the container started.
- Fix: `e2e/test_stack.py` waits 15 seconds, then polls `/actuator/health` and `/api/login` through Nginx for up to 3 minutes, logging each attempt.
- Status: Fixed in the repo. Needs a new deploy to take effect.

## Phone login rate limit blocked tests

- Issue: The test phone received HTTP 429.
- Root cause: Resilience4j allowed 5 attempts per phone every 15 minutes.
- Fix: Per-phone limit is 30 attempts per minute. The whole login endpoint is 300 attempts per minute.
- Status: Changed in `login-service` `application.yml`. The running image still has the old limit until it is rebuilt.

## Retry timing was too tight

- Issue: Inter-service retries were easy to exhaust during startup.
- Root cause: Both clients used 3 attempts starting at 200 milliseconds, then doubling.
- Fix: `clean-event-service` and `owner-notifier` now use 5 attempts starting at 100 milliseconds, still doubling.
- Status: Changed in both `application.yml` files. Needs a rebuild.

## Frontend files missing on the instance

- Issue: Nginx returned 403. The `out` folder on the instance was empty.
- Root cause: The site is a static Next.js export, and the deploy did not build it.
- Fix: `Dockerfile.frontend`, `deploy/build-frontend.sh`, and the Nginx image in compose and the pipeline.
- Status: Added. The image is built on the next deploy.

## No Supabase assertion in the E2E suite

- Issue: A Supabase URL and anon-key check would fail until those values are pasted on the Sync page.
- Root cause: `e2e/test_stack.py` never had that assertion. It calls Nginx, the Java APIs, and Zipkin only.
- Fix: No test was removed.
- Status: Confirmed. The Sync page step is still manual.

## Supabase is not connected

- Issue: The Java services use the local Postgres container. The browser app expects a Supabase URL and anon key.
- Root cause: Those values are entered in the Sync page, not in the repo. The local `.env` has no Supabase names.
- Fix: Not implemented in code. Paste the Project URL and anon public key on the Sync page, then press sync.
- Status: Waiting on that manual step. `app_state` on the instance had no rows.

## Actuator health endpoints

- Issue: Readiness was guessed from a login call. A 502 was the only signal that the process was down.
- Root cause: Actuator was installed but only `health` was exposed, and Nginx did not route it.
- Fix: All three services expose `health`, `metrics`, and `info` on `/actuator`, with details always shown. Login and clean-event include `db` and `diskSpace`. Owner-notifier includes `diskSpace`. Nginx proxies `/actuator/` to login-service.
- Status: Added in this commit.

## Deploy run 44566333807

- Issue: The containers job failed with exit code 1.
- Root cause: Compose started, then the E2E phone-login test got HTTP 502 because login-service was not ready.
- Fix: The readiness wait above.
- Status: Fixed in the test script. Not re-run yet.
