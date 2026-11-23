# TogetherWeGo — Product & Architecture Draft

> Status: **v0.4** (2026-11-24). Phases 0 (skeleton) and 1 (groups) are built; see the README for running it. Later phases are still a draft.
> Changes from v0.1: payments via **SePay**; **non-serverless** architecture (long-running containers on ECS/EC2 + RDS Postgres + Redis).

## 1. What it is

A web app for friend groups to **organize hangouts and share costs**:

- Create groups, invite friends, manage members and roles
- Plan hangouts/events with RSVP, time, location
- Log shared expenses, split them, see who owes whom, settle up
- Get notified (in-app + email) about events, new expenses, and payment reminders

## 2. Scope

### MVP (v1)

| Area | Features |
|---|---|
| **Auth** | Email/password + Google sign-in, profile (name, avatar, default currency) |
| **Groups** | Create / rename / archive group, invite by link or email, roles (owner, admin, member), leave / remove member |
| **Events (hangouts)** | Create event (title, time, location, description), RSVP (going / maybe / no), comments, cancel/reschedule |
| **Expenses** | Add expense (payer, amount, currency, split: equal / exact amounts / percentages / shares), attach receipt photo, edit/delete with audit trail, link expense to an event |
| **Balances & settle up** | Per-group balances, simplified debts ("A pays B 150k"), "Pay" button shows a VietQR (SePay) with amount + payment code; settlement auto-confirms via SePay webhook, or manual confirm by payee as fallback |
| **Payment accounts** | User adds bank account (bank + account no. + holder name) for QR; optionally connects SePay for auto-confirmation |
| **Notifications** | In-app (real-time bell + feed), email; per-user preferences per type |
| **Reminders** | Event reminder (e.g. 24h & 1h before), payment reminder for unsettled debts (e.g. weekly) |

### Later (v2+)

- Polls (pick a date/place), recurring events, calendar (.ics) export
- Web push notifications (PWA), mobile app
- Multi-currency with FX conversion, expense categories & stats

**Payments: SePay, payee-direct (see §7).** Money always goes **straight from payer's bank to payee's bank** via a VietQR code. There is no treasurer, group fund or central collector: every debt is settled peer-to-peer. Manual confirmation by the payee is the default; connecting SePay is an optional per-user upgrade for automatic confirmation (SePay tells us when the transfer landed). The app never holds or moves money (avoids needing a payment-intermediary licence).

## 3. Architecture (AWS, container-based, non-serverless)

One **NestJS** codebase runs as two long-lived processes: `api` (HTTP + WebSocket) and `worker` (background jobs). Both are packaged as Docker images and run on **ECS with EC2 instances**. Postgres is the source of truth. Redis provides job queues, WebSocket fan-out and caching.

```
                         ┌──────────────────────────────┐
   Browser ─────────────▶│ CloudFront + S3 (React SPA)  │
      │                  └──────────────────────────────┘
      │ HTTPS / WSS  (api.togetherwego.xxx)
      ▼
   ┌───────────────────────────── VPC ───────────────────────────────────┐
   │  ALB (HTTPS, sticky sessions for WS)                                │
   │    │                                                                │
   │    ▼                                                                │
   │  ECS service: api  (NestJS: REST + Socket.IO)  ×2 tasks             │
   │    │      │   │                                                     │
   │    │      │   └─ enqueue jobs ──┐                                   │
   │    │      ▼                     ▼                                   │
   │    │   RDS PostgreSQL      ElastiCache Redis ◀── Socket.IO adapter  │
   │    │      ▲                     │  (BullMQ queues, pub/sub)         │
   │    │      │                     ▼                                   │
   │    │   ECS service: worker (NestJS + BullMQ processors) ×1 task     │
   │    │         │ notifications, emails, reminders, expiry jobs        │
   │    │         ▼                                                      │
   │    │        SES (email)                                             │
   │    └──▶ S3 (receipts, avatars – pre-signed URLs)                    │
   └─────────────────────────────────────────────────────────────────────┘

   Payer's bank app ──transfer──▶ Payee's bank ──▶ SePay ──webhook──▶ ALB ──▶ api
                                                              POST /v1/webhooks/sepay
```

### Service choices

| Concern | Choice | Notes |
|---|---|---|
| Frontend | **React + Vite SPA on S3 + CloudFront** | Static files only. CloudFront also routes `/v1/*` to the ALB, so web and API share one origin: no CORS, first-party cookies. |
| Compute | **ECS on EC2** (Auto Scaling Group, `t4g.small` Graviton) | Two services: `api` and `worker`. The same image runs both, with a different start command. |
| Load balancer | **ALB** + ACM certificate | HTTPS. WebSocket supported natively. |
| Backend framework | **NestJS (TypeScript)** | Modules: auth, users, groups, events, expenses, settlements, payments, notifications |
| Database | **RDS PostgreSQL 17** (`db.t4g.micro` dev, Multi-AZ prod) | Relational fits a money ledger: real transactions, constraints, sums |
| ORM / migrations | **Prisma** | Migrations run as a one-off ECS task before deploy |
| Cache / queues / realtime | **ElastiCache Valkey 8** (Redis-compatible) | BullMQ queues + delayed jobs, Socket.IO Redis adapter, rate limiting |
| Realtime in-app | **Socket.IO** in the `api` service | One room per user (`user:<id>`), one room per group |
| Background jobs | **BullMQ** in the `worker` service | Notification fan-out, emails, event reminders (delayed jobs), weekly debt reminders (repeatable jobs), settlement expiry |
| Email | **SES** | Templated emails. Needs a verified domain and production access (leave the sandbox). |
| Auth | **NestJS + Passport (JWT + Google OAuth)** | Self-managed: access token (15 min) + refresh token (httpOnly cookie, rotated). Argon2 password hashes. |
| Files | **S3** with pre-signed upload URLs | |
| Container registry | **ECR** | |
| Secrets | **Secrets Manager** | DB password, JWT keys, SePay keys/tokens |
| IaC | **Terraform** (or AWS CDK) | Stacks: network, data, compute, web |
| CI/CD | **GitHub Actions** | Build image → push to ECR → run migration task → rolling ECS deploy |
| Observability | CloudWatch Logs + Container Insights, pino logs, alarms on 5xx / queue backlog / DB CPU | Sentry optional |
| Local dev | **docker compose**: postgres, redis, mailpit, minio | Same code, no AWS needed locally |

### Network & cost notes

- VPC with public subnets (ALB) and private subnets (ECS, RDS, Redis).
- To save money in dev, skip the NAT Gateway (about $32/month). Use VPC endpoints for ECR, S3, SES, Secrets Manager and CloudWatch Logs, or run the EC2 instances in public subnets with tight security groups.
- Rough dev cost: ALB about $18, EC2 t4g.small about $12, RDS t4g.micro about $13, Redis t4g.micro about $12 → **about $55–60/month**. Prod with Multi-AZ costs roughly 2–3× that.
- Cheaper start: run a single EC2 instance with docker compose and RDS. You can move to ECS later without code changes.

## 4. Data model (PostgreSQL)

All money stored as **`BIGINT` in minor units** (VND: whole đồng). Never use floats. Timestamps are `timestamptz`.

```
users(id, email UNIQUE, password_hash NULL, google_sub NULL, name, avatar_key,
      default_currency, notif_prefs JSONB, created_at)
refresh_tokens(id, user_id, token_hash, expires_at, revoked_at)

groups(id, name, currency, created_by, archived_at, created_at)
group_members(group_id, user_id, role ENUM(owner,admin,member), joined_at, left_at,
              PRIMARY KEY(group_id, user_id))
group_invites(code PK, group_id, created_by, expires_at, max_uses NULL, uses, revoked_at)

events(id, group_id, title, description, location, starts_at, ends_at,
       status ENUM(scheduled,cancelled), created_by)
event_rsvps(event_id, user_id, status ENUM(going,maybe,no), PRIMARY KEY(event_id,user_id))
event_comments(id, event_id, user_id, body, created_at)

expenses(id, group_id, event_id NULL, payer_id, amount BIGINT, currency, title,
         split_type ENUM(equal,exact,percent,shares), receipt_key, created_by,
         deleted_at, version INT, created_at)
expense_splits(expense_id, user_id, amount BIGINT, PRIMARY KEY(expense_id,user_id))
   -- CHECK: SUM(splits.amount) = expenses.amount (enforced in the service, inside one transaction)

settlements(id, group_id, from_user_id, to_user_id, amount BIGINT,
            payment_code UNIQUE, status ENUM(pending,confirmed,expired,cancelled),
            confirmed_by ENUM(sepay,manual) NULL, sepay_tx_id NULL,
            created_at, confirmed_at, expires_at)

payment_accounts(id, user_id, bank_code, account_number, holder_name,
                 sepay_connected BOOL, sepay_secret_ref, is_default)
sepay_transactions(id PK  -- SePay's id, used for dedupe
                   , account_number, amount BIGINT, content, reference_code,
                   transfer_type, raw JSONB, matched_settlement_id NULL,
                   status ENUM(matched,unmatched,ignored), received_at)

notifications(id, user_id, type, payload JSONB, read_at, created_at)
outbox(id, type, payload JSONB, created_at, processed_at)   -- see §6
activity_log(id, group_id, actor_id, action, entity, entity_id, diff JSONB, created_at)
```

**Balances are derived, not stored.** For each user, net balance = (sum of expenses they paid − sum of their splits) + (settlements they sent − settlements they received), counting only confirmed settlements. A single SQL query per group computes this, and groups are small. Add a materialized cache later if needed. The invariant (all members' balances in a group sum to 0) is tested.

**Debt simplification:** greedy matching of the largest creditor with the largest debtor, computed in `packages/shared` and unit tested.

**Concurrency:** expense edits use optimistic locking (`version`). Settlement confirmation uses `SELECT … FOR UPDATE` on the settlement row.

## 5. API sketch (REST, `/v1`)

```
POST   /auth/register  /auth/login  /auth/refresh  /auth/logout
GET    /auth/google    /auth/google/callback
GET    /me                          PATCH /me

GET    /groups                      POST  /groups
GET    /groups/:id                  PATCH /groups/:id
POST   /groups/:id/archive          POST  /groups/:id/unarchive          (owner)
GET    /groups/:id/invites          POST  /groups/:id/invites            (admin+)
DELETE /groups/:id/invites/:code    (revoke, admin+)
GET    /invites/:code               (preview)    POST /invites/:code/accept
DELETE /groups/:id/members/:userId  (remove; your own id = leave)
PATCH  /groups/:id/members/:userId  (change role, owner only; role=owner transfers ownership)

GET    /groups/:id/events           POST  /groups/:id/events
PATCH  /events/:id                  PUT   /events/:id/rsvp
GET/POST /events/:id/comments

GET    /groups/:id/expenses         POST  /groups/:id/expenses
PATCH  /expenses/:id                DELETE /expenses/:id
POST   /uploads/receipt-url         (returns pre-signed S3 PUT URL)

GET    /groups/:id/balances         (net + simplified "who pays whom")
POST   /groups/:id/settlements      (creates PENDING settlement + payment code, returns QR URL)
GET    /settlements/:id
PATCH  /settlements/:id             (manual confirm by payee, cancel by payer)

GET    /me/payment-accounts         POST /me/payment-accounts   DELETE /me/payment-accounts/:id
GET    /integrations/sepay/connect  GET  /integrations/sepay/callback
GET    /me/unmatched-transfers      POST /me/unmatched-transfers/:id/assign

GET    /notifications               PATCH /notifications/:id/read   POST /notifications/read-all

POST   /webhooks/sepay              (public; auth by SePay API key header)

WS     /realtime  (Socket.IO, JWT in handshake)
       server → client: notification.new, settlement.updated, expense.changed, event.changed
```

Guards: `JwtAuthGuard` everywhere except auth and webhooks. `GroupMemberGuard` and `GroupRoleGuard` on group-scoped routes. Input validation with **zod** schemas from `packages/shared` through a `ZodValidationPipe`, so the web forms and the API enforce the same rules. An OpenAPI spec is generated by `@nestjs/swagger`, and the frontend client is generated from it.

## 6. Notifications & reminders

**Transactional outbox** (so a notification is never lost and never sent for a rolled-back write):

1. In the same DB transaction as the business change, insert an `outbox` row (e.g. `ExpenseCreated`).
2. After commit, the `api` enqueues a BullMQ job right away. A worker cron also sweeps unprocessed `outbox` rows every 30s as a safety net.
3. The `notify` processor in the `worker`:
   - resolves recipients (group members minus the actor) and checks their preferences
   - inserts `notifications` rows (in-app feed)
   - publishes to Redis, and the Socket.IO adapter delivers to room `user:<id>` on whichever `api` task holds that connection
   - enqueues an `email` job (SES) if the user wants email for that type. Noisy types are batched into a digest.
4. **Event reminders:** on event create or update, add BullMQ **delayed jobs** with deterministic IDs (`event:<id>:24h`, `event:<id>:1h`). On reschedule or cancel, remove and re-add them. The job re-checks the event status before sending.
5. **Debt reminders:** a BullMQ **repeatable job** (e.g. Monday 9:00 Asia/Ho_Chi_Minh) finds non-zero balances and notifies debtors, with a per-pair cooldown.
6. **Settlement expiry:** a repeatable job marks `pending` settlements past `expires_at` as `expired`.

Notification types: `group.invited`, `group.member_joined`, `event.created`, `event.updated`, `event.cancelled`, `event.reminder`, `expense.added`, `expense.updated`, `settlement.requested`, `settlement.confirmed`, `debt.reminder`, `transfer.unmatched`.

## 7. Payments with SePay

SePay watches a bank account and sends a webhook for each incoming transfer. It also generates VietQR images (`https://qr.sepay.vn/img?acc=<acct>&bank=<bank>&amount=<amount>&des=<content>`), which any Vietnamese banking app can scan.

### Who receives the money

Money goes **directly to the payee's own bank account**. The app only creates the QR code and listens for SePay's confirmation.

| Payee state | Payer experience | Confirmation |
|---|---|---|
| Has bank account **and** connected SePay | Scan QR → pay | **Automatic** via webhook |
| Has bank account, no SePay | Scan QR → pay | Payee taps "I received it" (manual) |
| No bank account added | "Ask X to add bank info" | Manual only |

**Connect flow:** OAuth2 with SePay → tokens stored in Secrets Manager → we call SePay's Webhooks API (`POST /api/v1/webhooks`) to register our endpoint on the user's SePay account with a per-user generated API key. If OAuth app approval is slow, the fallback is that the user creates the webhook in SePay's dashboard and pastes in our URL and the API key we show them.

### Settle-up flow

1. Payer taps **Pay 150,000đ to B** → `POST /groups/:id/settlements`.
2. Server creates a `pending` settlement with a short unique **payment code**, e.g. `TWG8K3F2Q` (prefix + base32, no ambiguous characters), used as the transfer description.
3. Frontend shows the SePay QR (payee account, exact amount, `des=TWG8K3F2Q`), plus copy buttons, and listens on Socket.IO for `settlement.updated`.
4. Payer transfers from their bank app.
5. SePay → `POST /v1/webhooks/sepay`. The controller:
   - verifies the `Authorization: Apikey <key>` header against the payee's key (looked up by `accountNumber`); constant-time compare
   - ignores `transferType != "in"`
   - **dedupes** with `INSERT INTO sepay_transactions … ON CONFLICT (id) DO NOTHING`
   - extracts the payment code from `content` with a regex (banks sometimes add text, so search rather than exact-match)
   - in one DB transaction: lock the settlement, check that the amount and the payee account match, set it to `confirmed`, write an `outbox` row
   - responds `200 {"success": true}` fast; SePay retries failed deliveries about 7 times over about 30 minutes, so the handler must be idempotent
6. The worker notifies payer and payee, and the payer's open QR screen flips to "Paid ✓" in real time.
7. Edge cases:
   - **Underpaid** → partial settlement; the remaining debt stays open.
   - **Overpaid** → confirm the debt and credit the excess to the balance.
   - **No or unknown code** → the transfer lands in the payee's "unmatched transfers" inbox so they can assign it manually.

### Security

- The webhook route is public. Rate-limit it (Redis), validate the body, and log the raw payload.
- SePay API keys are random 32+ bytes, stored as a hash for lookup and the secret in Secrets Manager. Never log them.
- Only the webhook or the payee's own manual confirm can confirm a settlement. Never trust the client.
- Bank account numbers are PII. Show them only to members of shared groups.

## 8. Repo layout (pnpm monorepo)

```
TogetherWeGo/
├─ apps/
│  ├─ web/                 # React + Vite SPA
│  └─ server/              # NestJS app; `main.api.ts` and `main.worker.ts` entrypoints
│     └─ prisma/           # schema + migrations
├─ packages/
│  ├─ shared/              # types, money utils, split & simplify algorithms
│  └─ email-templates/     # React Email / MJML templates
├─ infra/                  # Terraform (network, data, compute, web)
├─ docker/                 # Dockerfile, docker-compose.yml for local dev
└─ docs/
```

## 9. Security & quality

- HTTPS everywhere (ACM on ALB and CloudFront). Secure, httpOnly, SameSite refresh cookie.
- Authorization in guards. Every group-scoped query is filtered by membership.
- Private subnets for ECS, RDS and Redis. Security groups allow only ALB → api, and api/worker → RDS/Redis.
- Least-privilege IAM task roles (S3 bucket prefix, SES send, specific secrets).
- Rate limiting via `@nestjs/throttler` with Redis storage. Add WAF on ALB/CloudFront later.
- RDS automated backups and point-in-time recovery. Deletion protection in prod.
- Unit tests for money math (splits, rounding remainders, simplification). These must be bulletproof.
- Integration tests with Testcontainers (Postgres + Redis). Playwright for the main web flows.
- CI: lint, test, build image. Deploy `dev` on main and `prod` on tag.

## 10. Delivery plan

| Phase | Deliverable |
|---|---|
| 0. Skeleton ✅ | Monorepo, docker compose local stack, NestJS + Prisma + auth (email/password, Google), React shell, Terraform for dev env, CI + deploy pipeline |
| 1. Groups ✅ | Groups, roles (owner/admin/member), ownership transfer, archive, invite links with expiry, use limits and revoke. Email invites wait for Phase 5. |
| 2. Money | Expenses, splits, balances, receipts |
| 3. Settle up | Bank accounts, SePay QR, settlements, webhook auto-confirm, manual confirm, unmatched inbox |
| 4. Events | Events, RSVP, comments, link expenses to events |
| 5. Notifications | Outbox → BullMQ → in-app feed + Socket.IO + SES email, preferences |
| 6. Reminders | Delayed and repeatable jobs for event and debt reminders |
| 7. Polish | i18n (vi/en), PWA, prod hardening (Multi-AZ, alarms, WAF) |

## 11. Open questions

1. **SePay connection:** is OAuth2 app registration with SePay available to us, or do we start with the manual webhook setup?
2. **Default currency:** VND? Is multi-currency within one group needed in v1?
3. **Who can edit or delete an expense:** anyone in the group, or only the creator and admins?
4. **Group size:** what is the expected max number of members?
5. ~~Compute~~ — decided: ECS on EC2 (Graviton `t4g.small`), bridge networking.
6. ~~Auth~~ — decided: self-managed in NestJS (JWT access token in memory, rotating httpOnly refresh cookie).
7. **Domain name** for SES and certificates?
8. ~~IaC~~ — decided: Terraform (`infra/`), S3 backend with native locking.
