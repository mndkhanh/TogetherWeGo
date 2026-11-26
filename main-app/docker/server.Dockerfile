# syntax=docker/dockerfile:1.7
# One image for the API, the worker and DB migrations; ECS picks the command.
#   api:     node dist/main.api.js      (default)
#   worker:  node dist/main.worker.js
#   migrate: node node_modules/prisma/build/index.js migrate deploy
# Build from the repo root: docker build -f docker/server.Dockerfile .

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Prisma detects the OpenSSL version to pick its schema-engine binary, so it must match runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
WORKDIR /repo

# ---- build ----
FROM base AS build
# Manifests first so dependency installs are cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/prisma.config.ts apps/server/
COPY apps/server/prisma apps/server/prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @twg/server...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm --filter @twg/shared build \
 && pnpm --filter @twg/server build \
 && pnpm --filter @twg/server deploy --prod --legacy /out

# ---- runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    # Trust Amazon RDS certificates so Postgres connections are verified TLS.
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl tini \
 && rm -rf /var/lib/apt/lists/*
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem

WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.api.js"]
