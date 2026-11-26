# TogetherWeGo demo (React + Firebase)

A small version of TogetherWeGo that runs entirely on Firebase:

- **Hosting** serves the React app (Vite, Tailwind v4), with SPA rewrites and cache headers.
- **Auth** signs people in with email/password or Google.
- **Firestore** stores groups, members, expenses, payments, plans and RSVPs. Screens update live
  (`onSnapshot`), so everyone in a group sees changes as they happen.
- **Security rules** ([`firestore.rules`](firestore.rules)) are the whole access-control layer: only
  members see a group, you can only join with its invite code and only as yourself, amounts must be
  whole positive dong, nobody can edit an expense after the fact, and so on. They're tested in
  [`tests/rules.test.ts`](tests/rules.test.ts) against the emulator.
- **Cloud Functions** ([`functions/src/index.ts`](functions/src/index.ts)) do the few things a
  client can't be trusted with: bank accounts, starting a bank-transfer payment, SePay keys and the
  SePay webhook.

Deploying the functions needs the pay-as-you-go **Blaze** plan (with a free monthly allowance a demo
won't get near). Locally, everything runs in the emulators for free.

What it does: create a group and share its invite link (the owner can replace the link, which stops
old ones working); add expenses split equally between chosen members; see your balance and the
fewest transfers that settle the group; pay by bank transfer (VietQR) or record cash; plan
hangouts and RSVP.

Compared with [`main-app`](../main-app/README.md) it leaves out receipts, chat, notifications,
reminders, uneven splits, sorting out unmatched transfers, and Vietnamese UI.

## Bank transfers and SePay

Same design as main-app:

1. **Getting paid** (header link): save the bank account people should pay you into. Only you can
   read it.
2. In a group's **Balances**, whoever owes taps **Pay by bank transfer**. A function makes a payment
   with a code like `TWG8K3F2QHN` and copies the payee's bank details into a document only the
   payer and payee can read. The payer sees a VietQR code (from `qr.sepay.vn`) that fills in the
   account, amount and code in any banking app.
3. The payee confirms it arrived (**Mark as received**), or SePay does it for them:
   - In **Getting paid**, **Set up SePay** shows a webhook URL and an API key, once.
   - In SePay (my.sepay.vn), add a webhook for that bank account with that URL, authentication
     type **API Key** with that key, and event money in ("Có tiền vào").
   - When money arrives with the code in the note, SePay calls the webhook and the payment turns
     to paid on everyone's screen.

The webhook (`/api/sepay-webhook`, a Hosting rewrite to the `sepayWebhook` function) is public, so
it trusts nothing until the API key matches someone. Only the key's SHA-256 is stored, a key can
only confirm payments owed to its owner, money for any other account is ignored, and SePay's
retries are recorded once. Moving to a different bank account turns SePay off.

**Try it locally without real money:** set up SePay in the app, start a bank transfer from a second
account, then pretend to be SePay:

```bash
pnpm sepay:simulate --key <the API key> --account <payee's account number> --amount 300000 --content "<payment code>"
```

SePay can't reach `localhost`, so a real SePay account needs the deployed app (or a tunnel to it).

## Run it locally

Needs Node 24, pnpm (`corepack enable`) and Java 21+ (for the Firestore emulator).

```bash
cd demo
pnpm install
npm install --prefix functions   # the functions are deployed on their own, so they use npm
cp .env.example .env.local       # points the app at the emulators
pnpm emulators                   # builds the functions; Auth :9099, Firestore :8085, Functions :5001, UI http://localhost:4005
pnpm dev                         # http://localhost:5180 (separate terminal)
```

The emulators use the project id `demo-togetherwego`: a `demo-` project never touches a real Firebase
project, and needs no login. Their data is gone when they stop.

## Checks

```bash
pnpm format:check && pnpm typecheck && pnpm test   # unit tests (money maths)
pnpm test:rules                                     # starts the Firestore emulator, runs the rules tests
pnpm test:payments                                  # Auth + Firestore + Functions emulators: bank transfers and the SePay webhook
pnpm build
```

## Deploy to a real Firebase project

1. Create a project in the [Firebase console](https://console.firebase.google.com/), add a **Web app**,
   enable **Authentication** (Email/Password and Google), create a **Firestore** database, and
   upgrade to the **Blaze** plan (needed for Cloud Functions).
2. Put the web app's config in `.env.production.local` (see `.env.example`; set
   `VITE_USE_EMULATORS=false`). These values are public by design: the rules protect the data.
3. Deploy:

   ```bash
   pnpm exec firebase login
   pnpm exec firebase use --add          # pick the project, alias it e.g. "prod"
   pnpm firebase:deploy                  # build, then deploy Hosting, Firestore rules and indexes, Functions
   ```

4. In Authentication > Settings > Authorized domains, check that your Hosting domain is listed.

## Layout

| Path                                        | What                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/lib/firebase.ts`                       | Firebase setup; connects to the emulators when `VITE_USE_EMULATORS=true`              |
| `src/lib/data.ts`                           | Every Firestore read and write, as hooks and functions                                |
| `src/lib/money.ts`                          | Parsing VND, equal splits, balances, settling debts                                   |
| `src/lib/payments.ts`                       | Bank accounts, bank-transfer payments, SePay (calls the functions)                    |
| `src/shared/`                               | Bank list and payment codes, used by the app and the functions (copied from main-app) |
| `functions/src/index.ts`                    | Cloud Functions: bank accounts, payments, SePay key and webhook                       |
| `scripts/sepay-simulate.mjs`                | Pretend to be SePay locally                                                           |
| `src/pages`, `src/components`               | Screens                                                                               |
| `firestore.rules`, `firestore.indexes.json` | Access control and indexes (deployed with `pnpm firebase:deploy`)                     |
| `firebase.json`                             | Hosting (rewrites, headers), emulator ports                                           |
