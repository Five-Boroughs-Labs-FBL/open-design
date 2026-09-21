ARG NODE_IMAGE=docker.io/library/node:24-bookworm-slim
ARG RUNTIME_IMAGE=docker.io/library/node:24-bookworm-slim

FROM ${NODE_IMAGE} AS build

ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG NO_PROXY

ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV http_proxy=${http_proxy}
ENV https_proxy=${https_proxy}
ENV no_proxy=${no_proxy}
ENV NO_PROXY=${NO_PROXY}
ENV CI=true

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/postinstall.mjs ./scripts/postinstall.mjs
COPY packages ./packages
COPY tools ./tools
COPY apps/daemon/package.json ./apps/daemon/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY e2e/package.json ./e2e/package.json
RUN corepack enable && \
    corepack prepare pnpm@10.33.2 --activate && \
    pnpm install --frozen-lockfile

COPY apps ./apps
RUN pnpm --filter @open-design/daemon build && \
    pnpm --filter @open-design/web build && \
    pnpm --filter @open-design/daemon deploy --legacy --prod /app/deploy/daemon && \
    pnpm store prune && \
    rm -rf \
      /root/.cache \
      /root/.local/share/pnpm/store \
      /app/deploy/daemon/node_modules/.cache \
      /app/deploy/daemon/node_modules/@types \
      /app/deploy/daemon/node_modules/.pnpm/@types+* \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/deps \
      /app/deploy/daemon/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3/src && \
    find /app/deploy/daemon/node_modules -type d \( \
      -name test -o \
      -name tests -o \
      -name "__tests__" -o \
      -name docs -o \
      -name doc -o \
      -name example -o \
      -name examples -o \
      -name ".github" \
    \) -prune -exec rm -rf '{}' + && \
    find /app/deploy/daemon/node_modules -type f \( \
      -name "*.md" -o \
      -name "*.markdown" -o \
      -name "*.d.ts" -o \
      -name "*.d.cts" -o \
      -name "*.d.mts" -o \
      -name "*.map" -o \
      -name "*.tsbuildinfo" -o \
      -name "binding.gyp" \
    \) -delete

# Stage-2 assets — copied into the build stage so the runtime stage
# can pull them via --from=build instead of reaching back into the
# build context.  This lets the Dockerfile work when the build context
# differs from the repo root (Railway, CI runners with a subdirectory
# context, etc.).
COPY skills ./skills
COPY design-systems ./design-systems
COPY craft ./craft
COPY prompt-templates ./prompt-templates
COPY assets ./assets
# `data/plugin-previews/manifest.json` is committed by the bake pipeline and is
# what `resolvePluginPreviewsDir()` looks for at runtime. Without it in the
# image, `loadManifest()` returns `{}` and every plugin silently falls back to
# the live-iframe preview path — the exact cost the bakes exist to avoid.
COPY data ./data
COPY plugins/_official ./plugins/_official

# Cursor Agent is a glibc Node plus `*-linux-*-gnu.node` addons. Alpine
# gcompat died on fcntl64; copying Debian libs into musl still failed at
# `cursor-agent --version` while loading those addons (Railway truncated
# the stack to index.js:414). Run the daemon on bookworm-slim too so
# better-sqlite3 and Cursor share a real glibc. Grok is static-pie and
# does not care which libc the OS uses.
FROM ${RUNTIME_IMAGE}

# bash: Cursor's launcher is `#!/usr/bin/env bash`. wget: linux compose
# healthcheck. ca-certificates: Cursor `--use-system-ca`.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      tini \
      poppler-utils \
      bash \
      git \
      curl \
      wget \
      ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 1001 open-design && \
    useradd --uid 1001 --gid open-design --no-create-home \
      --home-dir /home/open-design --shell /usr/sbin/nologin open-design && \
    mkdir -p /home/open-design && \
    chown open-design:open-design /home/open-design

ENV HOME=/home/open-design

# Same Grok + Muse CLIs AMC planner/builder/Design use (static linux-x86_64).
ARG GROK_VERSION=1.0.4
ARG MUSE_VERSION=1.3.0-R3233.1
ARG MUSE_SHA256=dfc52dc7d37e23d7618ed37a7ec3dd8d0f4c83c647b0f1cc2c2791274acabe78
ENV MUSE_NO_AUTO_UPDATE=1
RUN curl -fsSL -o /usr/local/bin/grok \
      "https://storage.googleapis.com/grok-build-public-artifacts/cli/grok-${GROK_VERSION}-linux-x86_64" && \
    chmod 0755 /usr/local/bin/grok && \
    /usr/local/bin/grok --version && \
    curl -fsSL -o /usr/local/bin/muse \
      "https://lookaside.facebook.com/lookaside/muse/download/?channel=muse&version=${MUSE_VERSION}&file=muse-x86-linux" && \
    echo "${MUSE_SHA256}  /usr/local/bin/muse" | sha256sum -c - && \
    chmod 0755 /usr/local/bin/muse && \
    /usr/local/bin/muse --version

# Design runs execute in this container. ACP forwards the selected Cursor
# model and CURSOR_API_KEY, but the ACP Design daemon still needs the Cursor
# Agent executable locally. Pin the package so image builds are reproducible;
# expose both the documented `agent` command and ACP Design's stable
# `cursor-agent` adapter name.
ARG TARGETARCH
ARG CURSOR_AGENT_VERSION=2026.09.10-fd3934a
RUN case "${TARGETARCH}" in \
      amd64) cursor_arch=x64 ;; \
      arm64) cursor_arch=arm64 ;; \
      *) echo "Unsupported Cursor Agent architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac && \
    mkdir -p /opt/cursor-agent && \
    curl -fsSL \
      "https://downloads.cursor.com/lab/${CURSOR_AGENT_VERSION}/linux/${cursor_arch}/agent-cli-package.tar.gz" \
      | tar --strip-components=1 -xzf - -C /opt/cursor-agent && \
    chmod 0755 /opt/cursor-agent/cursor-agent && \
    ln -s /opt/cursor-agent/cursor-agent /usr/local/bin/cursor-agent && \
    ln -s /opt/cursor-agent/cursor-agent /usr/local/bin/agent && \
    /usr/local/bin/cursor-agent --version

WORKDIR /app
COPY --from=build --chown=open-design:open-design /app/deploy/daemon ./apps/daemon
COPY --from=build --chown=open-design:open-design /app/apps/web/out ./apps/web/out
COPY --from=build --chown=open-design:open-design /app/skills ./skills
COPY --from=build --chown=open-design:open-design /app/design-systems ./design-systems
COPY --from=build --chown=open-design:open-design /app/craft ./craft
COPY --from=build --chown=open-design:open-design /app/prompt-templates ./prompt-templates
COPY --from=build --chown=open-design:open-design /app/data ./data
COPY --from=build --chown=open-design:open-design /app/assets/frames ./assets/frames
COPY --from=build --chown=open-design:open-design /app/assets/community-pets ./assets/community-pets
# Plan §3.J4 / spec §23.3.5 — bundled atom plugins registered on
# daemon boot. The directory contains `plugins/_official/atoms/<atom>/`
# pairs (SKILL.md + open-design.json); registerBundledPlugins() walks
# it on startup so the container ships with first-party atoms reachable
# via the same registry path third-party plugins use.
COPY --from=build --chown=open-design:open-design /app/plugins/_official ./plugins/_official

RUN mkdir -p /app/.od && \
    chown -R open-design:open-design /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=192
ENV HOME=/home/open-design
ENV OD_BIND_HOST=0.0.0.0
ENV OD_PORT=7456
ENV OD_DATA_DIR=/app/.od

EXPOSE 7456

USER open-design
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/daemon/dist/cli.js", "--no-open"]
