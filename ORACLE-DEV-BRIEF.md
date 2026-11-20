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
