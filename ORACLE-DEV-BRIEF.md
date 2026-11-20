# Oracle Deploy Brief — ArkaTasks deploy-oci branch

Branch `deploy-oci` is a full copy of `main`, AWS-only, never merged back to `main` or `dev`.

## Tasks

1. Delete the existing AWS GitHub Actions workflow from `.github/workflows` — this branch is Oracle-only.
2. Create an Oracle Terraform folder: VCN, subnet, security list, one Ampere A1 instance on Always Free tier (2 OCPUs, 12 GB RAM, shape `VM.Standard.A1.Flex`, no paid resources).
3. Add `install.sh` next to Terraform; the instance references it via `user_data` base64. The script installs Docker, Jenkins, Maven on first boot.
4. New GitHub Actions workflow in `.github/workflows`, triggered on push to `deploy-oci`. It SSHes into the VM and triggers the Jenkins pipeline — Jenkins is the pipeline engine, not direct SSH deploys. Jenkins has no public address; access via SSH tunnel. Jenkins auto-configures from a GitHub secret password. Include a Jenkins-free backup deploy path.
5. ARM build script: `docker build` with the ARM platform flag, same Dockerfile.
6. Edit the existing Docker Compose YAML directly: close public ports for Postgres, RabbitMQ, Zipkin, Eureka, notifier; Nginx on 80/443; Postgres data volume; memory caps ~4.6 GB; restart policies on Postgres and RabbitMQ.
7. Jenkins pipeline invokes Docker Compose after ARM images build.
8. Verify twice, file by file, in order: push → workflow → Terraform → startup script → Jenkins → ARM build → Compose → Nginx. Fix breaks on the branch.
9. GitHub secrets later: tenancy OCID, user OCID, API key fingerprint, private key.
10. Do not touch `main`, `dev`, or AWS files outside `deploy-oci`.
11. Frontend deployed separately — exclude it.
12. Supabase is the database; Oracle runs only app containers.

Commit and push to `deploy-oci` when done; report commits and files added.

## Required now: frontend-to-backend login connection

This code belongs on `deploy-oci` now. Live testing waits until the Oracle VM exists.

The settings page (Sync, embedded from `src/components/settings/settings-client.tsx`) has a Project URL field and an anon/security key field. The user enters both and connects to Supabase there. Only after that connection does the employee login page appear. When the employee logs in and the phone number is verified against Supabase, the frontend sends those same two values to the Oracle backend.

The request is `POST /api/login` with JSON `{phone, supabaseUrl, supabaseAnonKey}` and a Supabase bearer token. The backend receives them, saves them, and uses them through Supabase's web API (REST / PostgREST) for every microservice that needs database access. Placeholders for `SUPABASE_URL` and `SUPABASE_ANON_KEY` stay empty until that request. They are never hardcoded, never committed, and never a `service_role` key.

`Dockerfile.frontend` and the Next.js app under `src/` stay in the repo. The Oracle deploy does not build that image. The UI is deployed separately on Cloudflare.

The backend path to reuse is already in login-service: `POST /api/login` (`LoginController`, `SupabaseAuthFilter`, `SupabaseJwtVerifier`) reads `app_state` with the anon key, saves the URL and anon key with `SupabaseKeysFile`, and rejects a `service_role` key. `GET /api/employees/{id}` reads those saved keys. Do not add a second key store.

## Job-is-done flow (target)

1. Employee opens the employee page showing today's and tomorrow's jobs as tiles.
2. Employee taps a tile; it turns green.
3. Request goes to the Oracle backend (`POST /api/cleans`).
4. Backend validates the RS-256 token via Supabase keys. Verification uses Supabase's public JWKS key only. The private key stays with Supabase.
5. Event goes to Kafka.
6. Event is saved in a transactional outbox in Supabase.
7. RabbitMQ picks it up and triggers the notification service.
8. Notification service opens an automated WhatsApp message to the owner.

The outbox in Supabase is the transactional source of truth. The current code inserts into local Postgres `clean_outbox` and only then sends Kafka. The target order has to make the Supabase outbox commit the source of truth before consumers run. Do not keep a second local Postgres outbox.

## Current code vs target (Sonnet must close these gaps)

None of the items below are closed by the code on this commit.

- No employee page, job tiles, or done button exists in `src/` on this branch. Sonnet must add that UI.
- No frontend code calls `POST /api/login` or `POST /api/cleans`. The gap to fix and verify: `src/components/sync/sync-client.tsx` (`save` / `runConnect`, used at the bottom of `src/components/settings/settings-client.tsx`) stores the Project URL and anon key in the browser and talks to Supabase directly. It does not send `{phone, supabaseUrl, supabaseAnonKey}` to the Oracle backend. There is no employee-login function in `src/` that does so either.
- The frontend has no Supabase Auth sign-in that obtains the bearer token `POST /api/login` requires.
- The outbox is local Postgres `clean_outbox`, written in `CleanEventController.markClean` before `kafka.send`. Target: one transactional outbox in Supabase, and that write is the source of truth before Kafka consumers run.
- No Kafka consumer exists. `kafka.send` in clean-event-service has no `@KafkaListener`.
- `CleanEventController.relayPending` both publishes to RabbitMQ and calls owner-notifier over HTTP (`ownerNotifier.deliver`). That can notify twice, and there is no dedupe across those two paths.
- `owner-notifier` `OwnerNotifier.onClean` builds and logs a `wa.me` link from the employee phone (`employeePhone` / login lookup by employee id). It does not use the owner's phone and it does not send a WhatsApp message.
- Job status in `app_state` is never set to completed.
- No CORS configuration allows a Cloudflare-hosted frontend to call the Oracle API.
- `GET /api/notifications/latest` on owner-notifier is proxied by nginx at `/api/notifications` with no auth.
- Admin login is client-side. `src/lib/auth.ts` defaults to username `admin` and password `admin`, and `pushCredsToCloud` writes that username and password in plaintext to Supabase `app_login`. That is a security risk. Sonnet must not copy those defaults into the Oracle backend.
