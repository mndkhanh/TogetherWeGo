# TogetherWeGo — Product & Architecture Draft

> Status: **v0.9** (2026-11-26). Phases 0 (skeleton), 1 (groups), 2 (expenses), 3 (settle up), 4 (events), 5 (notifications) and 6 (reminders) are built; see the README for running it. Later phases are still a draft.
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

events(id, group_id, title, description, location, starts_at TIMESTAMPTZ, ends_at NULL,
       status ENUM(scheduled,cancelled), cancelled_at, created_by, version INT,
       created_at, updated_at, UNIQUE(id, group_id))
   -- CHECKs: title 1-80 chars, ends after it starts, cancelled <=> cancelled_at
   -- never deleted; no end time = assumed 3 hours long for "upcoming" vs "past"
event_rsvps(event_id, user_id, status ENUM(going,maybe,no), updated_at,
            PRIMARY KEY(event_id,user_id))
   -- kept when someone leaves, but only current members are counted or shown
event_comments(id, event_id, author_id, body CHECK 1-1000 chars, deleted_at, deleted_by,
               created_at)   -- plain text, soft-deleted by the author or an admin

expenses(id, group_id, event_id NULL, payer_id, amount BIGINT CHECK > 0, currency, title, note,
         split_type ENUM(equal,exact,percent,shares), spent_on DATE, receipt_key, created_by,
         deleted_at, version INT, created_at, updated_at)
   -- trigger expenses_event_same_group: an expense can only be linked to an event in its own
   --   group, even if the service had a bug. (It began as a composite foreign key, but Prisma
   --   can't model one and its generated migration silently dropped it; a test caught that.)
   --   Another trigger stops an event from ever moving to a different group.
expense_splits(expense_id, user_id, amount BIGINT CHECK >= 0, value INT,
               PRIMARY KEY(expense_id,user_id))
   -- value = what was entered: amount, basis points (percent) or shares
   -- SUM(splits.amount) = expenses.amount: checked by the service AND by a deferred
   --   constraint trigger at COMMIT, so a bug can't save unbalanced money

settlements(id, group_id, from_user_id, to_user_id, amount BIGINT, paid_amount BIGINT NULL,
            currency, payment_code UNIQUE, status ENUM(pending,confirmed,cancelled),
            confirmed_via ENUM(sepay,manual) NULL, created_by,
            created_at, confirmed_at, cancelled_at)
   -- amount = what was asked for; paid_amount = what actually arrived (balances use this)
   -- CHECKs: amounts > 0, not to self, code format, each status has exactly its fields
   -- trigger: confirmed rows never change; only status moves forward; never deleted
   -- "stale" (pending > 7 days) is derived, not stored; a late transfer still matches

payment_accounts(id, user_id UNIQUE, bank_bin, account_number, holder_name,
                 sepay_key_hash UNIQUE NULL, sepay_key_hint, sepay_last_event_at)
   -- one account per person; the SePay key itself is shown once and never stored
sepay_transactions(id, user_id (payee), payment_account_id NULL, sepay_id,
                   account_number, amount BIGINT, content, reference_code, transferred_at,
                   raw JSONB, status ENUM(matched,unmatched,ignored), settlement_id UNIQUE NULL,
                   received_at, resolved_at,
                   UNIQUE(user_id, sepay_id))   -- dedupe of SePay retries
   -- a bank record: kept when the payment account is removed

notifications(id, user_id, type, actor_id, data JSONB, outbox_id, read_at, created_at,
              UNIQUE(outbox_id, user_id))   -- a retried fan-out can't add a second copy
   -- data keeps names and titles as they were, so the feed reads the same later
notification_preferences(user_id, type, in_app, email, PRIMARY KEY(user_id, type))
   -- only differences from the defaults in @twg/shared are stored
outbox(id, type, payload JSONB, created_at, processed_at, attempts, last_error)   -- see §6
email_deliveries(id, outbox_id, user_id, to_address, subject, text, html, created_at, sent_at,
                 attempts, last_error, UNIQUE(outbox_id, user_id))
   -- written with the notifications; the email job carries only this id
activity_log(id, group_id, actor_id, action, entity, entity_id, diff JSONB, created_at)
   -- append-only: a trigger rejects UPDATE and DELETE (except when the whole group is deleted)
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

GET    /groups/:id/events           POST  /groups/:id/events   (?when=upcoming|past, ?cursor)
GET    /events/:id                  PATCH /events/:id   (whole event + version; 409 if changed)
POST   /events/:id/cancel           PUT   /events/:id/rsvp
GET    /events/:id/comments         POST  /events/:id/comments   (20/min)   DELETE /comments/:id
GET    /groups/:id/expenses?eventId=   (expenses linked to one event)

GET    /groups/:id/expenses         POST  /groups/:id/expenses     (?cursor, newest first)
GET    /expenses/:id                (with history + 5-minute receipt link)
PATCH  /expenses/:id                (whole expense + version; 409 if someone changed it first)
DELETE /expenses/:id                (soft delete)
POST   /groups/:id/receipts         (presigned S3 POST: key, type and max size pinned)

GET    /groups/:id/balances         (net + simplified "who pays whom")
GET    /groups/:id/settlements      POST /groups/:id/settlements
       (payer: PENDING + payment code; payee recording cash: CONFIRMED straight away)
GET    /settlements/:id             (payee bank details + QR only for the two people, only while pending)
POST   /settlements/:id/confirm     (payee only; optional amount that actually arrived)
POST   /settlements/:id/cancel      (either side, pending only)

GET    /me/payment-account          PUT /me/payment-account     DELETE /me/payment-account
POST   /me/payment-account/sepay-key   DELETE /me/payment-account/sepay-key   (key shown once)
GET    /me/unmatched-transfers      POST /me/unmatched-transfers/:id/assign   POST .../:id/ignore

GET    /notifications               POST /notifications/:id/read   POST /notifications/read-all
GET    /me/notification-preferences    PUT /me/notification-preferences

POST   /webhooks/sepay              (public; auth by SePay API key header)

WS     /v1/realtime  (Socket.IO, WebSocket transport only, access token in the handshake body)
       server → client: notification { notification, unreadCount }, session_expired
       The client refreshes whatever data the notification is about.
```

Guards: `JwtAuthGuard` everywhere except auth and webhooks. `GroupMemberGuard` and `GroupRoleGuard` on group-scoped routes. Input validation with **zod** schemas from `packages/shared` through a `ZodValidationPipe`, so the web forms and the API enforce the same rules. An OpenAPI spec is generated by `@nestjs/swagger`, and the frontend client is generated from it.

## 6. Notifications & reminders

**Transactional outbox** (so a notification is never lost and never sent for a rolled-back write):

1. In the same DB transaction as the business change, insert an `outbox` row (type, audience, data).
2. After commit, the `api` queues a `sweep` job right away. A worker job scheduler also sweeps every 30 s as the safety net for lost kicks.
   The sweep takes each row with `FOR UPDATE SKIP LOCKED`, so several workers never handle the same row. A row that fails is retried on later sweeps and left alone after 10 attempts (`last_error` says why).
3. The `notify` processor in the `worker`:
   - resolves recipients: current group members (never people who left), or the people involved (an expense's payer and sharers, the other side of a payment, an event's planner and attendees for chat), always minus the actor
   - checks each person's preferences (defaults per type in `@twg/shared`)
   - inserts `notifications` rows (in-app feed), unique per (outbox row, user)
   - records an `email_deliveries` row per email in the same transaction; only after commit does it queue one `email` job per row (job id = row id). Nothing is emailed for a fan-out that rolled back, and the sweep re-queues any row still unsent after 2 minutes (lost job). The email job skips rows already sent and sets `sent_at` right after the provider accepts. SMTP to Mailpit locally, SES on AWS. Email is at-least-once: a crash between SES accepting and `sent_at` being written can repeat one (SES has no idempotency key). A digest for noisy types is a later improvement.
   - after commit, publishes through Redis (`@socket.io/redis-emitter`); the Socket.IO adapter on whichever `api` task holds the user's connection delivers it to room `user:<id>`
   - the WebSocket sits outside Nest's guards, so it repeats their checks: Origin must be the app (no cross-site WebSocket hijacking), the CloudFront secret header must be present, the access token is verified in the handshake and the socket is closed when it expires
4. **Event reminders** (24 hours and 1 hour before):
   - `event_reminders` rows are the record. They are written in the same transaction that creates, moves or cancels the event: moving deletes the ones not yet handled and plans new ones, cancelling only deletes. A reminder already due (or due within a minute) is never planned; the "new event" notification covers it.
   - After commit, the `api` adds a BullMQ **delayed job** per row (job id = row id) and removes the jobs of deleted rows. The job is only for timing: a sweep every minute handles any due row whose job went missing.
   - Handling locks the event (`FOR SHARE`, in the same order as an edit: event, then its reminders, so a move or cancel in flight finishes first and one that starts later waits) and then the row (`FOR UPDATE SKIP LOCKED`), re-checks the event (still scheduled, group not archived, not started yet; a late 24-hour reminder that would land inside the last hour is skipped), writes an `event.reminder` outbox row for everyone going or maybe, and marks the row `sent` or `skipped`. A row is handled once, so a doubled job never reminds twice.
5. **Debt reminders:** a BullMQ **job scheduler** (cron `0 9 * * 1`, Asia/Ho_Chi_Minh: Monday 9:00) walks the non-archived groups with expenses. Per group, in one transaction: balances, then the suggested payments (the same ones the balances tab shows), then a `debt.reminder` to each current member who owes, naming who to pay. Skipped: anyone with a payment already pending in that group. The cooldown is per (group, person) in `debt_reminders`: an `INSERT … ON CONFLICT DO UPDATE … WHERE last_sent_at <= now − 6 days` claims the reminder, so a retried or doubled run never nags twice. A group that fails doesn't stop the others, but fails the job afterwards so BullMQ retries it; the cooldown makes the retry skip everyone already reminded.
6. **Stale payments:** not a job. A pending payment older than 7 days is shown as stale (derived on read); a late transfer still confirms it, because the money really moved.

Notification types: `group.member_joined`, `event.created`, `event.updated`, `event.cancelled`, `event.commented`, `event.reminder`, `expense.added`, `expense.updated`, `expense.deleted`, `settlement.requested`, `settlement.confirmed`, `settlement.cancelled`, `debt.reminder`, `transfer.unmatched`. Both reminder types are on in the app and by email by default, and can be turned off like any other.

## 7. Payments with SePay

SePay watches a bank account and sends a webhook for each incoming transfer. It also generates VietQR images (`https://qr.sepay.vn/img?acc=<acct>&bank=<bank>&amount=<amount>&des=<content>`), which any Vietnamese banking app can scan.

### Who receives the money

Money goes **directly to the payee's own bank account**. The app only creates the QR code and listens for SePay's confirmation.

| Payee state | Payer experience | Confirmation |
|---|---|---|
| Has bank account **and** connected SePay | Scan QR → pay | **Automatic** via webhook |
| Has bank account, no SePay | Scan QR → pay | Payee taps "I received it" (manual) |
| No bank account added | "Ask X to add bank info" | Manual only |

**Connect flow (built, manual):** the payee taps "Set up SePay"; we generate a random 256-bit API key, show it once with our webhook URL, and keep only its SHA-256. The payee adds a webhook in SePay's dashboard (auth type "API Key", event "money in"). Changing the bank account or turning SePay off invalidates the key. No SePay credentials of the user are ever stored. OAuth2 with SePay's Webhooks API is a possible later upgrade.

### Settle-up flow

1. Payer taps **Pay 150,000đ to B** → `POST /groups/:id/settlements`.
2. Server creates a `pending` settlement with a short unique **payment code**, e.g. `TWG8K3F2Q` (prefix + base32, no ambiguous characters), used as the transfer description.
3. Frontend shows the SePay QR (payee account, exact amount, `des=TWG8K3F2Q`), plus copy buttons, and listens on Socket.IO for `settlement.updated`.
4. Payer transfers from their bank app.
5. SePay → `POST /v1/webhooks/sepay`. The controller:
   - verifies the `Authorization: Apikey <key>` header by looking up the key's SHA-256 (no secret to compare in memory), then requires the payload's `accountNumber` (or `subAccount`) to be that payee's account
   - ignores `transferType != "in"`
   - **dedupes** with `INSERT INTO sepay_transactions … ON CONFLICT (id) DO NOTHING`
   - extracts the payment code from `content` with a regex (banks sometimes add text, so search rather than exact-match)
   - in one DB transaction: lock the settlement **owed to this key's owner** (`FOR UPDATE`) and both memberships (`FOR SHARE`, so it can't interleave with leaving), confirm it at the amount that arrived, link the transfer, write the activity log (the outbox row arrives with Phase 5)
   - responds `200 {"success": true}` fast; SePay retries failed deliveries about 7 times over about 30 minutes, so the handler must be idempotent
6. The payer's open QR screen polls every 4 s and flips to "Paid" (Socket.IO push and notifications arrive with Phase 5).
7. Edge cases:
   - **Underpaid** → partial settlement; the remaining debt stays open.
   - **Overpaid** → confirm the debt and credit the excess to the balance.
   - **No or unknown code** → the transfer lands in the payee's "unmatched transfers" inbox so they can assign it manually.
   - **Cancelled payment, or the payer has left** → still confirmed: real money moved, so the record must say so.
   - **Already confirmed** (manual confirm won the race) → the transfer goes to the inbox rather than counting twice.

### Security

- The webhook route is public. Rate-limit it (Redis), validate the body, and log the raw payload.
- SePay API keys are random 32 bytes, stored only as a SHA-256 hash (high entropy, so no KDF needed). The `Authorization` header is redacted from logs.
- A key only speaks for its owner: a webhook can only confirm payments owed to the key's owner, into that owner's account. Another user's valid key gets `unmatched` or `ignored`, never a confirmation.
- Leaving a group is refused while a payment involving you is pending.
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
| 2. Money ✅ | Expenses (equal / exact / percent / shares), balances with suggested payments, receipt photos on S3, edit history, optimistic locking. Leaving needs a zero balance. |
| 3. Settle up ✅ | Bank accounts, SePay QR, settlements (pay, record cash, partial/over payment), webhook auto-confirm, manual confirm, unmatched inbox |
| 4. Events ✅ | Events, RSVP, comments, cancel/reschedule, link expenses to events |
| 5. Notifications ✅ | Outbox → BullMQ → in-app feed + Socket.IO + email (SES / Mailpit), preferences |
| 6. Reminders ✅ | Event reminders (24 h and 1 h before; delayed jobs + sweep), weekly debt reminders (job scheduler, 6-day cooldown) |
| 7. Polish | i18n (vi/en), PWA, prod hardening (Multi-AZ, alarms, WAF) |

## 11. Open questions

1. ~~SePay connection~~ — decided: manual webhook setup with a per-user API key we generate (OAuth2 later, if SePay approves an app).
2. **Default currency:** VND? Is multi-currency within one group needed in v1?
3. ~~Who can edit or delete an expense~~ — decided: the person who added it, the person who paid, or a group admin/owner. Expenses involving someone who has left are frozen.
4. **Group size:** what is the expected max number of members?
5. ~~Compute~~ — decided: ECS on EC2 (Graviton `t4g.small`), bridge networking.
6. ~~Auth~~ — decided: self-managed in NestJS (JWT access token in memory, rotating httpOnly refresh cookie).
7. **Domain name** for SES and certificates?
8. ~~IaC~~ — decided: Terraform (`infra/`), S3 backend with native locking.
