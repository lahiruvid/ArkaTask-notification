# ArkaTasks on Oracle Cloud (Always Free)

This folder is the `deploy-oci` branch's infrastructure. It creates one Ampere A1 VM in a public subnet and leaves application deploy to Jenkins on that VM.

No tenancy OCID, user OCID, API key, or password belongs in git.

## What Terraform creates

- A VCN `10.42.0.0/16`, an internet gateway, and a public route table.
- A public subnet `10.42.1.0/24`. Its security list and the instance NSG allow only:
  - TCP 22 from `ssh_cidr`
  - TCP 80 and TCP 443 from the internet
- Nothing else is open. Postgres `5432`, RabbitMQ `5672`, Zipkin `9411`, Eureka `8761`, owner-notifier `8083`, and Jenkins `8080` are not in the security list or the NSG. Zipkin, login, and clean-event are published on `127.0.0.1` only. Jenkins listens on `127.0.0.1:8080`.
- One `VM.Standard.A1.Flex` instance, default 2 OCPU and 12 GB (the variables reject anything above that), on the latest Ubuntu 24.04 aarch64 image for that shape.
- A reserved public IPv4 address. The instance also gets an ephemeral address at boot so `bootstrap.sh` has a network route; the reserved address replaces it before apply finishes. Outputs use the reserved address.
- Cloud-init user data is `bootstrap.sh`.

There is no NAT gateway and no service gateway. The VM is in the public subnet, so apt and image pulls use the internet gateway. A NAT gateway is not an Always Free resource, and a private subnet would not have outbound internet without one. Free Tier tenancies have also been limited to zero NAT gateways and sometimes zero service gateways until the account is upgraded.

The default security list that Oracle creates with the VCN is emptied of ingress rules. The subnet does not use it.

## Memory

Container limits in `docker-compose.yml` add up to about 5 GB:

| Service | Limit |
| --- | --- |
| db | 1 GB |
| kafka | 768 MB (heap 512 MB) |
| rabbitmq | 512 MB |
| zipkin | 384 MB |
| eureka | 384 MB |
| login-service | 640 MB (heap 384 MB) |
| clean-event-service | 640 MB (heap 384 MB) |
| owner-notifier | 512 MB |
| nginx | 128 MB |

Jenkins is capped at a 768 MB heap (about 1 GB resident). Ubuntu and Docker use the rest of the 12 GB. Bootstrap also adds a 2 GB swap file. Postgres data is on the `pgdata` volume, so it survives `compose up` but not replacement of the instance.

## One-time state bucket

Create this yourself before the first `terraform init`. Terraform does not create it.

1. In the home region, create a private Object Storage bucket. The name is the value you will store as `TF_STATE_BUCKET`.
2. Enable object versioning on the bucket.
3. On the Tenancy details page, copy the Object Storage namespace. That value is `TF_STATE_NAMESPACE`.
4. Give the API user permission to read and write objects in that bucket (`OBJECT_INSPECT`, `OBJECT_READ`, `OBJECT_CREATE`, `OBJECT_DELETE`, or `manage objects` on the bucket).

`backend.hcl.example` shows the local `-backend-config` file. Do not commit a filled-in `backend.hcl`.

The API user also needs, in the target compartment:

- `manage virtual-network-family` (VCN, subnet, security lists, NSG, reserved public IP)
- `manage instance-family`
- `manage volume-family` (the boot volume)
- `read` instance images and availability domains in the tenancy

Use a compartment quota if you want the tenancy capped at 2 OCPU and 12 GB of A1.

## GitHub Actions secrets

Required. The workflow stops before Terraform if any of these are missing or malformed.

| Secret | Value |
| --- | --- |
| `OCI_TENANCY_OCID` | Tenancy OCID |
| `OCI_USER_OCID` | User OCID that owns the API key |
| `OCI_FINGERPRINT` | Fingerprint of that API key |
| `OCI_PRIVATE_KEY` | PEM of the API signing key, including the BEGIN and END lines |
| `OCI_REGION` | Home region, such as `eu-frankfurt-1` |
| `OCI_COMPARTMENT_OCID` | Compartment for the VCN and instance |
| `OCI_SSH_PUBLIC_KEY` | One OpenSSH public key line for the `ubuntu` user |
| `OCI_SSH_PRIVATE_KEY` | Matching private key, used only for SSH from Actions |
| `OCI_SSH_CIDR` | Who may open port 22, such as `203.0.113.10/32` |
| `TF_STATE_BUCKET` | Bucket name from the one-time step |
| `TF_STATE_NAMESPACE` | Object Storage namespace |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `DB_PASSWORD` | Postgres password. One line. |
| `JENKINS_ADMIN_PASSWORD` | Jenkins user `admin`. One line, at least 8 characters. |

Optional.

| Secret | Value |
| --- | --- |
| `OCI_AVAILABILITY_DOMAIN_INDEX` | `0`, `1`, or `2` if the first availability domain has no A1 capacity. Default is 0. |
| `SUPABASE_ANON_KEY` | Anon JWT (`role` is `anon`) or an `sb_publishable_` key. A `service_role` JWT or `sb_secret_` key fails the workflow. Leave unset to save the key later in the app. |
| `OCIR_REGION_KEY` | Short region key, such as `fra` for `eu-frankfurt-1`. |
| `OCIR_NAMESPACE` | Tenancy namespace used by OCIR. |
| `OCIR_USERNAME` | OCIR username after the namespace slash. Identity Cloud users include the `oracleidentitycloudservice/` prefix. |
| `OCIR_AUTH_TOKEN` | OCIR auth token. Set all four OCIR secrets or none. |

The workflow never reads a Supabase service role key. Do not add one.

## What the workflow does

`.github/workflows/deploy-oci.yml` runs on a push to `deploy-oci` and on `workflow_dispatch`.

1. It checks the secrets above and exits before any cloud call if they are missing.
2. It writes the API key to a file mode `600`, then `terraform init` with `-backend-config`, `terraform plan -out=tfplan`, and `terraform apply tfplan`.
3. It reads the `public_ip` output and waits up to 20 minutes for `/var/lib/arkatasks-bootstrap.done`.
4. It rsyncs this repo to `/opt/arkatasks` on the VM as `ubuntu`.
5. It writes `.env` (`SUPABASE_URL`, `DB_PASSWORD`, `REGISTRY=local`), the Jenkins password file, and, when provided, the anon-key seed and `.ocir.env`.
6. It runs `deploy/arkatasks-configure-jenkins.sh`, which turns the setup wizard off, binds Jenkins to `127.0.0.1:8080`, sets the admin user from the password file, seeds the job `arkatasks-deploy` from the Jenkinsfile, restarts Jenkins, and checks that the Jenkins process is in the `docker` group.
7. It triggers that job, prints the console log, and fails if the build is not `SUCCESS`.
8. It checks `http://<public-ip>/` and prints `docker compose ps`.

The Jenkins job builds `linux/arm64` images on the VM with `deploy/build-arm.sh` (no QEMU), runs `deploy/compose-up.sh`, seeds the anon key if present, then health-checks nginx and the localhost service ports.

`REGISTRY=local` tags are `local/arkatasks-employee-notification:<service>` and are loaded into the local engine. Compose uses `pull_policy: if_not_present`, so `up` does not try to pull those tags from a registry. Public images (Postgres, Kafka, RabbitMQ, Zipkin) are pulled if they are missing.

If all four OCIR secrets are set, the job logs in as `<namespace>/<username>` at `<region-key>.ocir.io` and pushes instead. The same prefix is written to `.env`, so compose pulls those tags if they are not already local.

Jenkins credential IDs, if you add them later in the Jenkins UI instead of GitHub secrets: `ocir-region-key`, `ocir-namespace`, `ocir-username`, `ocir-auth-token` (all secret text).

## Jenkins in a browser

Jenkins is not on the public internet. From your laptop:

```bash
ssh -i <path-to-private-key> -L 8080:127.0.0.1:8080 ubuntu@<public-ip>
```

Open `http://127.0.0.1:8080` and sign in as `admin` with `JENKINS_ADMIN_PASSWORD`. `terraform output jenkins_tunnel` prints that command with the reserved IP filled in.

## Fallback without Jenkins

On the VM, after `.env` exists:

```bash
cd /opt/arkatasks/ArkaTask-employee-notification
bash deploy/deploy-direct.sh
```

That script runs the same build, compose up, anon-key seed, and health check without the Jenkins job.

## Local checks

```bash
cd ArkaTask-employee-notification/terraform-oci
terraform fmt -check
terraform init -backend=false
terraform validate
```

`terraform validate` does not contact Oracle and does not need credentials.

Changing `bootstrap.sh` after the first apply does not rebuild the VM (`ignore_changes` on user data and the image). Jenkins settings are reapplied from git on every deploy. OS package changes in `bootstrap.sh` apply to a new instance, or you can run the same commands over SSH.

## Image names

| Tag | Dockerfile context |
| --- | --- |
| `eureka` | `employee-service/eureka-server` |
| `login-service` | `employee-service/login-service` |
| `clean-event-service` | `employee-service/clean-event-service` |
| `owner-notifier` | `owner-notifier` |
| `nginx` | repository root (`Dockerfile.frontend` copies `package.json` and `nginx.conf` from there) |

## Risks

- Always Free A1 capacity is often unavailable (`Out of host capacity`). Set `OCI_AVAILABILITY_DOMAIN_INDEX` to another domain and rerun. Do not terminate the instance casually; capacity may not come back.
- Idle Always Free A1 instances can be reclaimed when CPU, network, and memory stay under 20% for 7 days.
- Replacing the instance deletes the boot volume, including `pgdata`.
- A reserved public IP that you detach and leave unused can be billed. This stack keeps it attached.
- Docker-published ports are reached through the NSG. Host iptables rules are still opened for 80 and 443 because Ubuntu images REJECT other inbound traffic, but the NSG is what blocks 5432 and the other application ports.
- Nginx generates a self-signed certificate the first time the container starts. Port 80 is plain HTTP.
- The first `apk add openssl` inside nginx runs in a 128 MB limit. If that start is killed, raise only that service's `mem_limit`.
- Jenkins stores the admin password in `/var/lib/jenkins/casc/jenkins.yaml` mode `600`, owned by `jenkins`, because JCasC reads it there. It is not in git.
- `build-and-push.sh` and the nested `.github/workflows/deploy.yml` still contain the old AWS flow. This branch does not run them. Use `deploy/build-arm.sh`.
