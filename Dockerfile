# syntax=docker/dockerfile:1
FROM node:24-slim AS base
ENV COREPACK_HOME=/opt/corepack
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/server/prisma ./apps/server/prisma
COPY packages/shared/package.json ./packages/shared/
# tsx and prisma are devDependencies, and the workspace config allows esbuild/prisma install scripts.
RUN pnpm install --frozen-lockfile --filter @livemate/server...
RUN pnpm --filter @livemate/server exec prisma generate

FROM base AS runtime
COPY --from=deps --chown=node:node /opt/corepack /opt/corepack
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

ENV NODE_ENV=production
# Use the dependencies installed in the deps stage at startup.
ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 4000}/health`).then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
CMD ["sh", "-c", "pnpm --filter @livemate/server exec prisma migrate deploy && pnpm --filter @livemate/server start"]
