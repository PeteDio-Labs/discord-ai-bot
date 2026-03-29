# syntax=docker/dockerfile:1
# Build stage
FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy package files + registry config (no creds — injected via --secret)
COPY package.json bun.lockb* .npmrc ./

# Install dependencies — mount Nexus auth token as a secret (never stored in layer)
RUN --mount=type=secret,id=npmrc_auth,target=/tmp/npmrc_auth \
    if [ -f /tmp/npmrc_auth ]; then cat /tmp/npmrc_auth >> .npmrc; fi && \
    bun install --frozen-lockfile && \
    rm -f .npmrc

COPY tsconfig.json ./
COPY src ./src

RUN bun run build

# Production stage
FROM oven/bun:1-alpine

WORKDIR /app

# Copy package files + registry config (no creds)
COPY package.json bun.lockb* .npmrc ./

# Install prod dependencies — same secret mount, never stored in layer
RUN --mount=type=secret,id=npmrc_auth,target=/tmp/npmrc_auth \
    if [ -f /tmp/npmrc_auth ]; then cat /tmp/npmrc_auth >> .npmrc; fi && \
    bun install --frozen-lockfile --production && \
    rm -f .npmrc

COPY --from=builder /app/dist ./dist

CMD ["bun", "run", "start"]
