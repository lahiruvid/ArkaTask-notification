# Follow-up

## Migrate AWS auth from static keys to OIDC

The `.env` key file stays in use until this is done. Do not remove `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` before OIDC works.

1. In AWS IAM, create an identity provider for GitHub (`token.actions.githubusercontent.com`) with the GitHub org/repo as the audience.
2. Create an IAM role that trusts that OIDC provider and has AdministratorAccess, or a tighter policy, scoped to the repo.
3. Update the Terraform config and CI (Jenkins or GitHub Actions) to use `aws-actions/configure-aws-credentials` with `role-to-assume` and the web identity token, instead of `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
4. Remove the `.env` key file approach only after OIDC works.
