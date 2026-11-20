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
14. Build the frontend-to-backend login connection: the frontend settings page sends the two Supabase keys (project URL and anon key) to the Oracle backend at employee login; the backend receives, saves, and uses them via Supabase's web API for every microservice needing DB access. The backend only needs Supabase's public key to check the RS-256 token; refuse a service role key if sent.
15. With Postgres removed, build the Supabase transactional outbox: after Kafka receives the clean event, write it to the Supabase outbox table so RabbitMQ can pick it up and trigger the notification service (WhatsApp to owner). Note today's code writes the outbox before Kafka — the target order is Kafka first, then outbox.

## End-to-end Oracle deploy flow

Sonar implements this path. The steps are fixed:

1. The developer pushes code to the GitHub repo.
2. The GitHub Actions workflow triggers automatically on that push.
3. The workflow uses a GitHub personal access token secret (repo scope) for any GitHub API calls.
4. The workflow SSHes into the Oracle VM with the SSH private key secret, and the VM authenticates it through the public key in ~/.ssh/authorized_keys.
5. The workflow pulls the latest code onto the Oracle VM.
6. The workflow hands off to Jenkins on the VM, and Jenkins picks up the build.
7. Jenkins builds the Docker image(s).
8. Jenkins logs in to Docker Hub with the Docker Hub username and access token secrets.
9. Jenkins pushes the image(s) to Docker Hub.
10. Jenkins deploys and runs the containers on the Oracle VM from those images (docker compose pull + up -d).

```
developer push
      |
      v
GitHub Actions  -- GH_TOKEN (repo) --> GitHub API, if needed
      |
      | SSH_PRIVATE_KEY
      v
Oracle VM  (ubuntu, public key in ~/.ssh/authorized_keys)
      |
      | git pull latest deploy-oci
      v
Jenkins on 127.0.0.1:8080
      |
      +-- mvn test
      +-- docker build linux/arm64
      +-- docker login  (DOCKERHUB_USERNAME + DOCKERHUB_TOKEN)
      +-- docker push   --> Docker Hub
      +-- docker compose pull && up -d
      +-- health check
      +-- image prune
```

## GitHub Actions secrets

> **PENDING SECRETS - READ FIRST**
>
> **All the Oracle-related secret keys are currently set in GitHub to placeholder values like "pending": SSH_PRIVATE_KEY, GH_TOKEN, DOCKERHUB_USERNAME and DOCKERHUB_TOKEN. They must be replaced with real values before the first deploy. Sonar should treat the code as complete apart from these pending secret values.**
>
> Use these exact secret names in `.github/workflows/deploy-oci.yml` and in Jenkins. Do not rename them. A workflow step must fail fast, before Terraform or SSH, with a clear message if `SSH_PRIVATE_KEY`, `GH_TOKEN`, `DOCKERHUB_USERNAME`, or `DOCKERHUB_TOKEN` is missing or still equals `pending`.

| Secret | Use |
| --- | --- |
| `SSH_PRIVATE_KEY` | Deploy SSH private key. Actions uses it to SSH in. The matching public key is what the VM has in `~/.ssh/authorized_keys`. |
| `OCI_SSH_PUBLIC_KEY` | Public key Terraform writes onto the instance. It must be the public half of `SSH_PRIVATE_KEY`. |
| `GH_TOKEN` | GitHub personal access token, repo scope, for any GitHub API call. `GITHUB_` is reserved, so the name is `GH_TOKEN`. |
| `DOCKERHUB_USERNAME` | Docker Hub user. |
| `DOCKERHUB_TOKEN` | Docker Hub personal access token, description `github-actions-deploy`, Read & Write. |
| `OCI_TENANCY_OCID`, `OCI_USER_OCID`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY`, `OCI_REGION`, `OCI_COMPARTMENT_OCID`, `OCI_SSH_CIDR` | Existing Oracle API and network secrets. |
| `TF_STATE_BUCKET`, `TF_STATE_NAMESPACE` | Terraform state bucket and object-storage namespace. |
| `JENKINS_ADMIN_PASSWORD` | Jenkins admin password. JCasC reads it on the VM. Never commit it. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Public project URL and public anon key only. Never a `service_role` key. See tasks 11, 12, and 14: login still sends these at runtime. |

Jenkins must not have the Docker Hub token in git. The workflow passes `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` over SSH into Jenkins credentials (JCasC or a Jenkins env file written at deploy time, mode 600). Suggested credential ids: `dockerhub-username` and `dockerhub-token`.

## Jenkinsfile stages

Order, replacing local tags and ECR/OCIR with Docker Hub:

1. Checkout
2. Build/test (Maven)
3. Docker build (ARM64, `linux/arm64`)
4. Docker Hub login
5. Push
6. Deploy (`docker compose pull` and `up -d`)
7. Health check
8. Cleanup/prune

Image names move from `local/arkatasks-employee-notification:<service>` and from ECR/OCIR to `docker.io/<DOCKERHUB_USERNAME>/arkatasks-employee-notification:<service>`.

## Docker on the Oracle VM

`ArkaTask-employee-notification/terraform-oci/bootstrap.sh` installs Docker Engine and the Compose plugin on first boot. Both are free. Jenkins uses that Docker to build, push, and run.

## Oracle Always Free Ampere

Since 15 June 2026, Ampere A1 Always Free is limited to 2 OCPUs. Size the instance for that. `terraform-oci/variables.tf` already defaults to 2 OCPUs and 12 GB and rejects `ocpus` above 2, so it does not use more than the cap. Sonar must keep that alignment and must not raise it.

Never click Upgrade to a paid account. Compartment quota policies are the only hard stop. A budget only sends an email alert. It does not stop spending.

## Supabase free database

The free Supabase plan is enough for 50 users. There is no Postgres container (tasks 6 and 12). The frontend sends the project URL and the public anon key at employee login (tasks 11 and 14). The backend refuses a service role key.

## Cost guardrails

- Always Free shapes only. A1 stays inside the free 2 OCPU / 12 GB limit.
- Boot volume stays inside the free 200 GB.
- No load balancer and no other paid service.
- A compartment quota policy is the hard stop.
- A budget alert email is extra warning, not a stop.
- Docker Hub free plan: 1 private repo, or publish public images. Pulls are rate-limited.
- Jenkins prunes unused images on the VM after deploy.

## Only the secret values need to be added manually later

Only the secret values need to be added manually later (GitHub Actions secrets and Jenkins credentials). Everything else must be complete, working code: no TODOs, no placeholders except secret references.

The four secrets that already exist as the placeholder `pending` are called out above. Replacing `pending` with real values is a manual step. Sonar does not invent stand-in passwords, keys, or tokens in the repo.

## Sonar must implement

- `.github/workflows/deploy-oci.yml`: on push to `deploy-oci`, fail fast if `SSH_PRIVATE_KEY`, `GH_TOKEN`, `DOCKERHUB_USERNAME`, or `DOCKERHUB_TOKEN` is missing or equals `pending`. Use `GH_TOKEN` for GitHub API calls. SSH with `SSH_PRIVATE_KEY`. Pull the latest commit on the VM. Hand off to Jenkins. Do not build images in Actions.
- `ArkaTask-employee-notification/Jenkinsfile`: the eight stages above. Docker Hub login and push use the Jenkins credentials filled from `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.
- `ArkaTask-employee-notification/terraform-oci/bootstrap.sh`: Docker Engine and Compose plugin stay installed and free. Jenkins stays on `127.0.0.1:8080`.
- `ArkaTask-employee-notification/docker-compose.yml` and `docker-compose.registry.yml`: app images come from Docker Hub. `docker compose pull` then `up -d`. No Postgres container. No frontend image. Nginx stays the stock proxy on 80/443.
- `ArkaTask-employee-notification/terraform-oci`: keep `VM.Standard.A1.Flex` at 2 OCPUs and 12 GB. Do not add a load balancer or any paid resource. Quota policy and budget alert stay documented as operator steps, not as fake paid resources.

### Conflicts with the code Sonar is editing

- Deploy SSH in `.github/workflows/deploy-oci.yml` uses `OCI_SSH_PRIVATE_KEY`. Sonar must switch that step to `SSH_PRIVATE_KEY`. Terraform still installs `OCI_SSH_PUBLIC_KEY`. Those two must be one key pair.
- App images are `local/arkatasks-employee-notification:<service>` or OCIR (`deploy/jenkins-build.sh` logs in to `<region-key>.ocir.io`). `deploy/compose-up.sh` still accepts `ECR_REGISTRY`. `deploy/build-and-push.sh` and the nested `ArkaTask-employee-notification/.github/workflows/deploy.yml` still target Amazon ECR. The Oracle path must push to and pull from Docker Hub instead. Do not revive ECR or OCIR for this branch.
- There is no `GH_TOKEN`, `DOCKERHUB_USERNAME`, or `DOCKERHUB_TOKEN` reference yet, and nothing fails when a secret is still `pending`.
- Container memory limits add up to about 3.9 GB, not 4.6 GB. That is under the task 6 figure because the Postgres container is gone. Sonar should keep the sum at or under about 4.6 GB.

### Status of the conflicts (20 Nov 2026)

All four are resolved on `deploy-oci`:

- Deploy SSH uses `SSH_PRIVATE_KEY`; the workflow checks that `OCI_SSH_PUBLIC_KEY` is its public half.
- ECR and OCIR are gone. Jenkins builds `linux/arm64` images and pushes `docker.io/<DOCKERHUB_USERNAME>/arkatasks-employee-notification:<service>`; Compose pulls them (`docker-compose.registry.yml`).
- `GH_TOKEN`, `DOCKERHUB_USERNAME`, and `DOCKERHUB_TOKEN` are wired in, and the first workflow job fails when any required secret is missing or `pending`.
- Container limits add up to about 3.6 GB with JVM heap caps, restart policies, and 4 GB swap. The target order of task 15 (Kafka first, then the Supabase outbox, then RabbitMQ) is implemented in clean-event-service.

Details and the remaining manual steps: `ArkaTask-employee-notification/terraform-oci/README.md`.
