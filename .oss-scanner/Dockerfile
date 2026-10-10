FROM oven/bun:1.3.12 AS bun
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git python3 build-essential zip \
    && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# OSS Scanner expects sources and test tooling in /src, with no network after build.
# Keep the full .git history: production builds use it for catalog revisions.
COPY . /src
WORKDIR /src
RUN git rev-parse --is-shallow-repository | grep -qx false \
    && bun install --frozen-lockfile \
    && bun run typecheck \
    && bun run build:browsers

# Tests remain available for offline reproduction; do not bake provider credentials in.
CMD ["bash"]
