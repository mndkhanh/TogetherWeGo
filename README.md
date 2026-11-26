# TogetherWeGo

Plan hangouts with friends, split shared costs, and settle up. This repository holds two builds of the
same app:

| Folder | What | Stack |
|---|---|---|
| [`main-app/`](main-app/README.md) | The full product | NestJS API + worker, PostgreSQL, Redis, React; AWS (ECS on EC2, RDS, CloudFront) with Terraform; SePay payments |
| [`demo/`](demo/README.md) | A small version on Firebase: groups, expenses, balances, bank transfers with SePay, plans | React + Firebase (Hosting, Auth, Firestore, security rules, Cloud Functions) |

Each folder is its own project with its own `package.json`, lockfile and README. CI runs per folder:
`.github/workflows/ci.yml` and `deploy-dev.yml` for `main-app/`, `demo-ci.yml` for `demo/`.
