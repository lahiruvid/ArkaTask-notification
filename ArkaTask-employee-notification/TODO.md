# OCI deploy

This branch deploys the employee stack to Oracle Cloud through GitHub Actions, Jenkins, and Docker Hub. Secrets, the deploy flow, memory limits, TLS, Supabase setup, and the Jenkins SSH tunnel are in `terraform-oci/README.md`.

Known gap: owner-notifier builds a WhatsApp click-to-chat link with the cleaner's number and does not send a message. Switching it to the owner's number is a later task.
