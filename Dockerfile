FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex

WORKDIR /app
COPY server.js /app/server.js

ENV CODEX_BRIDGE_HOST=0.0.0.0
ENV CODEX_BRIDGE_PORT=8787
ENV CODEX_BRIDGE_CWD=/workspace

EXPOSE 8787

CMD ["node", "/app/server.js"]
