# syntax=docker/dockerfile:1
FROM node:24-slim AS base
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/
# tsx is a devDependency, and the workspace config allows esbuild's install script.
RUN pnpm install --frozen-lockfile --filter @livemate/server...

FROM base AS runtime
COPY --from=deps --chown=node:node /opt/corepack /opt/corepack
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY --exclude=**/.env.example packages/shared ./packages/shared
COPY --exclude=**/.env.example apps/server ./apps/server

ENV NODE_ENV=production
# Use the dependencies installed in the deps stage at startup.
ENV PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 4000}/health`).then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]
CMD ["pnpm", "--filter", "@livemate/server", "start"]
