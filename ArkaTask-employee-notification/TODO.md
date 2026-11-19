# AWS auth

This project uses GitHub OIDC only. The deploy workflow assumes the IAM role `GitHubActionsRole`. Do not add static access keys.

1. In AWS IAM, the GitHub identity provider is `token.actions.githubusercontent.com`, with audience `sts.amazonaws.com`.
2. The role trusts that provider and is scoped to this repo.
3. GitHub Actions uses `aws-actions/configure-aws-credentials` with `role-to-assume` and the web identity token.
