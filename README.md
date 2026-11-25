# TogetherWeGo

Plan hangouts with friends, split shared costs, and settle up by bank transfer (VietQR via SePay).
Design and roadmap: [docs/DESIGN.md](docs/DESIGN.md).

| Path | What |
|---|---|
| `apps/server` | NestJS API (`main.api.ts`) and background worker (`main.worker.ts`), Prisma + PostgreSQL, BullMQ + Redis |
| `apps/web` | React + Vite SPA, Tailwind v4, shadcn/ui (Base UI) |
| `packages/shared` | Types, zod schemas and money utilities used by both |
| `docker/` | Local dev stack (`docker-compose.yml`) and the server image (`server.Dockerfile`) |
| `infra/` | Terraform: `bootstrap/` (state bucket), `modules/`, `envs/dev/` |
| `scripts/deploy-ecs.sh` | Used by CI: migrate the database, then roll out ECS services |

## Local development

Requirements: Node 24, Docker, and pnpm (`corepack enable`, or `npm i -g pnpm`).

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # then set JWT_ACCESS_SECRET (command in the file)
pnpm db:up                                      # Postgres :5432, Valkey :6380, Mailpit :8025, RustFS (S3) :9000/:9001
pnpm --filter @twg/shared build
pnpm db:migrate
pnpm dev                                        # API on :3100, web on http://localhost:5173
pnpm dev:worker                                 # background worker: notifications, email and reminders (separate terminal)
```

Emails are caught by Mailpit locally: open http://localhost:8025.

The web app calls the API on the same origin (`/v1/*`): Vite proxies it locally and CloudFront routes it in AWS,
so there is no CORS and the refresh-token cookie stays first-party.

Host ports can be changed if they clash with other projects: `TWG_POSTGRES_PORT=5442 TWG_REDIS_PORT=6390 pnpm db:up`
(update `DATABASE_URL` / `REDIS_URL` in `apps/server/.env` to match).

### Checks

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @twg/server test:e2e     # needs `pnpm db:up` and migrations
```

## AWS (dev environment)

Architecture: CloudFront → (S3 for the SPA | ALB for `/v1/*`) → ECS on EC2 (Graviton) running `api` and `worker`
→ RDS PostgreSQL 17 + ElastiCache Valkey, all in `ap-southeast-1`. Rough cost: ~$55–60/month.

One-time setup:

1. **State bucket**
   ```bash
   cd infra/bootstrap && terraform init && terraform apply
   ```
2. **Dev environment** — copy `infra/envs/dev/terraform.tfvars.example` to `terraform.tfvars`, then:
   ```bash
   cd infra/envs/dev
   terraform init -backend-config="bucket=<state_bucket from step 1>"
   terraform plan -out tfplan && terraform apply tfplan
   ```
   Services start with the placeholder image tag `bootstrap` and stay unhealthy until the first deploy.
3. **GitHub Actions** — add every key/value from `terraform output github_actions_variables` as a repository
   *variable* (Settings → Secrets and variables → Actions → Variables), and create an environment named `dev`.
   No AWS keys are stored in GitHub: the deploy job assumes an IAM role through OIDC, and only from `main`.
4. Push to `main`. CI runs; when it passes, **Deploy dev** builds the arm64 image, runs migrations as a one-off
   ECS task, rolls out the services (automatic rollback on failed health checks), uploads the SPA and smoke-tests
   `/v1/health`.

Useful commands:

```bash
aws logs tail /ecs/twg-dev/api --follow                 # API logs
aws ssm start-session --target <instance-id>            # shell on an ECS instance (no SSH)
```

### Security defaults

- No inbound internet access to the app except through CloudFront; the ALB requires CloudFront's IP ranges and
  a secret `x-origin-verify` header.
- Postgres and Redis live in private subnets with no internet route, TLS required (`rds.force_ssl`, `rediss://`).
- Containers run as a non-root user with a read-only root filesystem and all Linux capabilities dropped;
  IMDSv2 with hop limit 1 stops containers from reading the instance role's credentials.
- Secrets come from Secrets Manager at container start (the RDS master password is managed by RDS itself).
- Money is integer minor units. The database itself rejects unbalanced splits (deferred trigger) and
  non-positive amounts, and the activity log is append-only.
- Receipt photos go straight from the browser to a private S3 bucket through presigned POSTs that pin the
  key, type and size; the API checks a key belongs to the group before attaching it, and photos are viewed
  through 5-minute presigned links. The task role can only read and write `receipts/*`.
- Payments never pass through the app: money goes bank to bank. Only the person being paid (or their bank, via
  SePay) can confirm a payment; the person who owes can't mark their own debt as paid. A confirmed payment can
  never change and payments are never deleted (database trigger).
- The SePay webhook is public, so it trusts nothing until a per-user API key checks out. Only the key's SHA-256
  is stored, and a key can only confirm payments to its own owner, so a forged webhook from one user's SePay
  can't settle someone else's debt. Retries are idempotent (unique SePay id per payee).
- Bank account numbers are shown only to the two people in a pending payment.
- Event titles, descriptions, locations and comments are plain text: React escapes them and nothing is ever
  rendered as HTML. The map link is built from the location as an encoded query parameter, never a URL the
  user typed. Comments are rate-limited (20 a minute).
- Notifications use a transactional outbox: written in the same transaction as the change, so nothing is
  sent for a change that rolled back and nothing is lost if Redis or the worker is down. Fan-out is idempotent.
  People who have left a group never receive its notifications.
- Reminders are planned in the database with the event, so a lost job only makes one late, never lost; each
  is handled once. Debt reminders claim a 6-day cooldown per person and group in the same transaction, so a
  retried job never nags twice.
- The realtime WebSocket checks the Origin header and the CloudFront secret itself (it sits outside Nest's
  middleware), takes the access token in the handshake body (never a cookie or the URL), and hangs up when the
  token expires. Each socket can only join its own user's room.
- Emails escape everything users typed, and subjects are stripped of line breaks (no header injection). Only the
  worker can send email: it has its own IAM role limited to `ses:SendEmail` from one sender address.
- Access tokens live in memory only; refresh tokens are httpOnly, `SameSite=Lax`, scoped to `/v1/auth`,
  rotated on every use, with reuse detection that revokes the whole session family.
