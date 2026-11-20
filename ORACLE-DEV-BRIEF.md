# Oracle Deploy Brief — ArkaTasks deploy-oci

What we are building: ArkaTasks is a cleaning business app for holiday apartments. Admin manages places, cleaners, and a job calendar. Cleaners see today's and tomorrow's jobs on their employee page; tapping a tile marks it green (place cleaned) and sends that event to the backend.

Target flow: employee taps tile → request to Oracle backend → backend validates RS-256 token via Supabase public/private key → event to Kafka → saved in transactional outbox in Supabase → RabbitMQ picks it up → notification service opens automated WhatsApp message to the owner.

Note: today's code writes the outbox before Kafka; treat the above as the target and list gaps.

Branch deploy-oci is a full copy of main, AWS-only, never merged back to main or dev.

## Tasks

1. Delete the existing AWS GitHub Actions workflow from .github/workflows — Oracle-only branch.
2. Oracle Terraform folder: VCN, subnet, security list, one Ampere A1 instance, Always Free tier (2 OCPUs, 12 GB, shape VM.Standard.A1.Flex, no paid resources).
3. install.sh next to Terraform, referenced via user_data base64; installs Docker, Jenkins, Maven on first boot.
4. New GitHub Actions workflow triggered on push to deploy-oci: SSHes into VM and triggers the Jenkins pipeline (Jenkins is the pipeline engine). Jenkins has no public address; SSH tunnel access. Jenkins auto-configures from a GitHub secret password. Include a Jenkins-free backup deploy path.
5. ARM build script: docker build with ARM platform flag, same Dockerfile.
6. Edit existing Docker Compose YAML directly: close public ports for RabbitMQ, Zipkin, Eureka, notifier; Nginx on 80/443; no Postgres container (Supabase is the database); no frontend container (frontend deploys separately on Cloudflare); memory caps about 4.6 GB; restart policies on remaining services.
7. Jenkins pipeline invokes Docker Compose after ARM images build.
8. Verify twice file by file in order: push → workflow → Terraform → startup script → Jenkins → ARM build → Compose → Nginx. Fix any break on the branch.
9. GitHub secrets later: tenancy OCID, user OCID, API key fingerprint, private key file.
10. Do not touch main, dev, or AWS files outside deploy-oci.
11. Frontend-to-backend login connection code must be built in this branch now: frontend settings page (project URL and anon key fields) sends both Supabase keys to the Oracle backend at employee login; backend receives, saves, and uses them via Supabase's web API for every microservice needing DB access. Live testing waits for the Oracle VM, but the code belongs here. Backend only needs Supabase's public key to check the token; refuse a service role key if sent.
12. Supabase is the database; Oracle runs only app containers.
13. WhatsApp: today's code only builds a link using the cleaner's number and does not send; switching to the owner's number is a later task — note as known gap.
