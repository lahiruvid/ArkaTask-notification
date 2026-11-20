# ArkaTasks on Oracle Cloud (Always Free)

This folder is the `deploy-oci` branch's infrastructure. Terraform creates one Ampere A1 VM in a public subnet. Jenkins on that VM builds, pushes, and runs the application.

No tenancy OCID, user OCID, API key, token, or password belongs in git.

## Deploy flow

```
push to deploy-oci
  -> GitHub Actions  .github/workflows/deploy-oci.yml
       secrets  fail fast if a secret is missing or still "pending"; GH_TOKEN reads the commit via the GitHub API
       verify   Maven tests (4 services), frontend lint + build, compose/shellcheck, terraform validate
       deploy   terraform apply (keeps the VM), SSH with SSH_PRIVATE_KEY,
                git fetch of the pushed commit into /opt/arkatasks with GH_TOKEN,
                deploy/vm-jenkins-deploy.sh writes .env and the Jenkins secret files, configures Jenkins, runs the job
  -> Jenkins on 127.0.0.1:8080  ArkaTask-employee-notification/Jenkinsfile
       Checkout -> Build/test (Maven) -> Docker build (linux/arm64) -> Docker Hub login
       -> Push -> Deploy (compose pull + up --wait) -> Health check -> Cleanup (prune)
```

Images: `docker.io/<DOCKERHUB_USERNAME>/arkatasks-employee-notification:<service>`, plus `:<service>-<commit>` for rollbacks. The Docker Hub free plan allows one private repository; all four services are tags in that one repository.

Rollback on the VM: `IMAGE_TAG_SUFFIX=-<commit> docker compose -f docker-compose.yml -f docker-compose.registry.yml up -d` from `/opt/arkatasks/ArkaTask-employee-notification` (after `docker login`, if the repository is private).

## GitHub Actions secrets

The workflow stops in its first job when any required secret is empty or equals `pending`. Secret names cannot start with `GITHUB_`.

| Secret | Value |
| --- | --- |
| `SSH_PRIVATE_KEY` | Private key the workflow uses to SSH in as `ubuntu`. |
| `OCI_SSH_PUBLIC_KEY` | Public half of `SSH_PRIVATE_KEY`, one OpenSSH line. Terraform installs it on the VM. The workflow checks that the two match. |
| `GH_TOKEN` | GitHub personal access token with read access to this repository (classic `repo`, or fine-grained Contents: read). Used for the GitHub API check and the `git fetch` on the VM. It is never written to disk there. |
| `DOCKERHUB_USERNAME` | Docker Hub user name (lowercase). |
| `DOCKERHUB_TOKEN` | Docker Hub personal access token, Read & Write. |
| `JENKINS_ADMIN_PASSWORD` | Jenkins user `admin`. One line, at least 8 characters. |
| `OCI_TENANCY_OCID`, `OCI_USER_OCID`, `OCI_FINGERPRINT` | API user and key fingerprint. |
| `OCI_PRIVATE_KEY` | PEM of the API signing key, including the BEGIN and END lines. |
| `OCI_REGION` | Home region, such as `eu-frankfurt-1`. |
| `OCI_COMPARTMENT_OCID` | Compartment for the VCN and instance. |
| `OCI_SSH_CIDR` | Who may open port 22, such as `203.0.113.10/32`. GitHub-hosted runners use changing addresses, so a narrow CIDR blocks the workflow; see Risks. |
| `TF_STATE_BUCKET`, `TF_STATE_NAMESPACE` | State bucket and Object Storage namespace (one-time setup below). |

Optional:

| Secret | Value |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co`. Pins the backend to this project: no other project's tokens or keys are accepted. Recommended. |
| `SUPABASE_ANON_KEY` | The public anon (or `sb_publishable_`) key. A `service_role` or `sb_secret_` key fails the workflow. |
| `OCI_AVAILABILITY_DOMAIN_INDEX` | `0`, `1`, or `2` if the first availability domain has no A1 capacity. |

Without `SUPABASE_URL` the first verified employee login names the project and the backend keeps it after restarts. Setting the secret closes that first-login window.

On the VM, Docker Hub and Jenkins secrets live only in `/etc/arkatasks/jenkins-secrets/` (one file each, mode 600, owner `jenkins`). Jenkins Configuration as Code (`deploy/jenkins/jenkins.yaml`) reads them and creates the credentials `dockerhub-username` and `dockerhub-token`. `.env` holds public values only.

## What Terraform creates

- A VCN `10.42.0.0/16`, an internet gateway, and a public route table.
- A public subnet `10.42.1.0/24`. Its security list and the instance NSG allow only TCP 22 from `ssh_cidr`, and TCP 80 and 443 from the internet.
- One `VM.Standard.A1.Flex` instance, 2 OCPU and 12 GB (the variables reject more), on the latest Ubuntu 24.04 aarch64 image, 50 GB boot volume.
- A reserved public IPv4 address. The VNIC starts without an ephemeral address, because OCI will not attach a reserved address to a private IP that already has one; `bootstrap.sh` waits for the reserved address before it installs anything.
- Cloud-init user data is `bootstrap.sh`: Docker Engine, the Compose and Buildx plugins, Jenkins (Java 21, stopped until the first deploy), JDK 17 and Maven for the test stage, 4 GB swap with `vm.swappiness=10`, and host iptables rules for 80 and 443.

No NAT gateway, service gateway, or load balancer. Nothing paid.

## Containers and memory

Only Nginx is public. The other ports are bound to `127.0.0.1` on the VM.

| Container | Image | Port on the VM | Memory limit | JVM heap |
| --- | --- | --- | --- | --- |
| nginx | `nginx:stable-alpine` | 80, 443 (public) | 64 MB | - |
| login-service | Docker Hub | 127.0.0.1:18081 | 512 MB | 256 MB |
| clean-event-service | Docker Hub | 127.0.0.1:18082 | 576 MB | 288 MB |
| owner-notifier | Docker Hub | 127.0.0.1:18083 | 448 MB | 224 MB |
| eureka | Docker Hub | none | 384 MB | 192 MB |
| kafka | `apache/kafka:3.9.1` | none | 768 MB | 384 MB |
| rabbitmq | `rabbitmq:4.1-alpine` | none | 512 MB | - |
| zipkin | `openzipkin/zipkin:3` | 127.0.0.1:9411 | 384 MB | 160 MB |
| **Total** | | | **3.6 GB** | |

Every JVM also has a metaspace cap and exits on `OutOfMemoryError`, so `restart: unless-stopped` brings it back instead of leaving a stuck process. Jenkins is capped at a 768 MB heap. The rest of the 12 GB is for Ubuntu, Docker builds, and the page cache; swap is the last resort.

There is no Postgres container (Supabase is the database) and no frontend container (the web UI is on Cloudflare Pages).

## One-time state bucket

Create this yourself before the first run. Terraform does not create it.

1. In the home region, create a private Object Storage bucket. Its name is `TF_STATE_BUCKET`.
2. Enable object versioning on the bucket.
3. On the Tenancy details page, copy the Object Storage namespace. That value is `TF_STATE_NAMESPACE`.
4. Give the API user `manage objects` on that bucket.

The API user also needs, in the target compartment, `manage virtual-network-family`, `manage instance-family`, `manage volume-family`, and `read` on instance images and availability domains in the tenancy.

Cost guardrails are operator steps, not Terraform resources: a compartment quota (for example A1 at 2 OCPU and 12 GB) is the only hard stop; a budget alert only sends email. Never upgrade the account to paid.

## TLS and the frontend

Nginx serves a self-signed certificate from `/etc/arkatasks/certs` until you replace it. The Cloudflare frontend is served over HTTPS, so browsers will only call the API over HTTPS with a trusted certificate:

1. Point a DNS name (for example `api.example.com`) at the reserved IP.
2. Put a certificate and key for it in `/etc/arkatasks/certs/tls.crt` and `tls.key` on the VM (for example from certbot in standalone mode during a short Nginx stop). Deploys keep existing files.
3. Build the frontend with `NEXT_PUBLIC_API_BASE_URL=https://api.example.com` in the Cloudflare Pages build settings.
4. Optional: set `CORS_ALLOW_ORIGIN=https://<your-app>.pages.dev` in `/opt/arkatasks/ArkaTask-employee-notification/.env` to accept only your frontend. The default `*` is safe for this API because it uses bearer tokens, not cookies.

## Supabase

- Run `supabase/schema.sql` (repository root) in the SQL editor. It creates `clean_outbox` with RLS policies for the anon role.
- Employee tokens must be signed with an asymmetric key: in Supabase, Project Settings > JWT signing keys, use an RS256 (or ES256) key. HS256 tokens are rejected.
- Enable anonymous sign-ins (Authentication > Sign In / Providers). The employee page signs in anonymously and sends that token to the backend.

## Jenkins in a browser

Jenkins is not on the public internet:

```bash
ssh -i <path-to-private-key> -L 8080:127.0.0.1:8080 ubuntu@<public-ip>
```

Open `http://127.0.0.1:8080` and sign in as `admin` with `JENKINS_ADMIN_PASSWORD`. `terraform output jenkins_tunnel` prints the command with the IP filled in.

## Backup deploy without Jenkins

On the VM, after one workflow run has written `.env` and the secret files:

```bash
cd /opt/arkatasks/ArkaTask-employee-notification
bash deploy/deploy-direct.sh
```

It builds the arm64 images, pushes them when the Docker Hub token is present, runs `docker compose up --wait`, and the same health check. Maven tests are skipped; the Docker build still compiles everything.

## Local checks

```bash
cd ArkaTask-employee-notification/terraform-oci
terraform fmt -check
terraform init -backend=false
terraform validate
```

`terraform validate` does not contact Oracle.

Changing `bootstrap.sh` after the first apply does not rebuild the VM (`ignore_changes` on user data and the image). Jenkins configuration and plugins are reapplied from git on every deploy.

## Risks

- Always Free A1 capacity is often unavailable (`Out of host capacity`). Set `OCI_AVAILABILITY_DOMAIN_INDEX` to another domain and rerun. Do not terminate the instance casually; capacity may not come back.
- GitHub-hosted runners SSH in from many addresses. `OCI_SSH_CIDR` must allow them (for example `0.0.0.0/0` with key-only SSH, which Ubuntu on OCI enforces), or use a self-hosted runner with a fixed address.
- Idle Always Free A1 instances can be reclaimed when CPU, network, and memory stay under 20% for 7 days.
- Replacing the instance deletes the boot volume. Application data is in Supabase, but queued Kafka and RabbitMQ messages on the VM are lost.
- A reserved public IP left detached can be billed. This stack keeps it attached.
- WhatsApp: owner-notifier builds a click-to-chat link with the cleaner's number and does not send anything. Switching to the owner's number is a later task.
