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
