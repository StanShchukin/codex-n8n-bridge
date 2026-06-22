# Codex n8n Bridge

HTTP bridge that lets n8n call `codex exec` as a local API.

Current published image:

```text
ghcr.io/stanshchukin/codex-n8n-bridge:latest
```

Default local URL:

```text
http://localhost:8787
```

From n8n running in Docker, use:

```text
http://host.docker.internal:8787
```

## What It Does

The bridge exposes a small HTTP API:

```text
GET  /              Service info and endpoint list
GET  /ui            Lightweight local web panel
GET  /health        Health check
GET  /api/accounts  Account list and active account
GET  /api/status    Bridge, login, and Codex CLI status
POST /codex/exec    Runs Codex CLI non-interactively
```

It runs `codex exec` inside the container and returns `stdout`, `stderr`, and the exit code as JSON.

## Quick Start

Start the container:

```powershell
.\start-container.ps1
```

The container uses:

```text
container: codex-n8n-bridge
port:      8787:8787
volume:    codex-n8n-bridge:/root/.codex
```

Health check:

```powershell
curl.exe http://localhost:8787/
curl.exe http://localhost:8787/health
```

Expected `/` response:

```json
{
  "ok": true,
  "service": "codex-n8n-bridge",
  "endpoints": {
    "health": "GET /health",
    "exec": "POST /codex/exec"
  }
}
```

Web panel:

```text
http://localhost:8787/ui
```

The panel can:

```text
show bridge and Codex login status
create and switch Codex accounts
start Codex device login for the active account
logout Codex from an account profile
run a test codex exec prompt
temporarily update Codex CLI inside the running container
```

## Multi-Account Mode

The bridge supports multiple Codex auth profiles in the same Docker volume.

```text
metadata: /root/.codex/bridge-accounts.json
profiles: /root/.codex/accounts/<accountName>/
```

Account names may use only letters, numbers, dash, and underscore. Examples:

```text
default
main
test
client-a
```

Use the `/ui` panel to:

```text
create an account
add a manual limit note
select the active account
start device login for that account
logout from that account
delete unused accounts
```

The active account is used by default for n8n requests. You can also select an account per API call:

```json
{
  "prompt": "Say OK only.",
  "accountName": "main",
  "sandbox": "read-only",
  "disableMcp": true,
  "timeoutSeconds": 180
}
```

Account API:

```text
GET  /api/accounts
POST /api/accounts/create
POST /api/accounts/select
POST /api/accounts/delete
POST /api/accounts/note
```

## Login

Codex auth is stored in the Docker volume `codex-n8n-bridge`.

Run:

```powershell
.\login-container.ps1
```

Follow the Codex login flow. After login, verify:

```powershell
docker exec codex-n8n-bridge codex login status
```

Expected:

```text
Logged in using ChatGPT
```

## Updating Codex CLI

The `/ui` panel has an `Update Codex CLI` button. It runs:

```text
npm install -g @openai/codex@latest
```

inside the currently running container.

This is useful for testing, but it is not the durable release path. If the container is recreated from the image, the image's bundled Codex version is used again. For a persistent update, rebuild and push the Docker image:

```powershell
docker build -t codex-n8n-bridge:local -t ghcr.io/stanshchukin/codex-n8n-bridge:latest .
docker push ghcr.io/stanshchukin/codex-n8n-bridge:latest
docker compose -f .\docker-compose.container.yml up -d --force-recreate
```

## n8n HTTP Request Node

Method:

```text
POST
```

URL:

```text
http://host.docker.internal:8787/codex/exec
```

Headers:

```text
Content-Type: application/json
X-Codex-Bridge-Token: codex-local-test
```

Body JSON:

```json
{
  "prompt": "Say OK only.",
  "accountName": "default",
  "sandbox": "read-only",
  "disableMcp": true,
  "timeoutSeconds": 180
}
```

Expected successful response:

```json
{
  "ok": true,
  "exitCode": 0,
  "stdout": "OK\n",
  "stderr": "..."
}
```

## Request Body

`prompt` is required.

```json
{
  "prompt": "Your Codex task",
  "accountName": "default",
  "sandbox": "read-only",
  "disableMcp": true,
  "timeoutSeconds": 180,
  "cwd": "/workspace"
}
```

Fields:

```text
prompt          Required. Prompt passed to codex exec.
accountName     Optional. Uses the active UI account when omitted.
sandbox         Optional. Defaults to read-only. Use workspace-write for edits.
disableMcp      Optional. Defaults from CODEX_BRIDGE_DISABLE_MCP.
timeoutSeconds  Optional. Request timeout for codex exec.
cwd             Optional. Must stay inside CODEX_BRIDGE_CWD.
```

## Security Notes

Set a real bridge token before using this beyond local experiments:

```yaml
CODEX_BRIDGE_TOKEN: your-secret-token
```

Do not expose this service to the public internet. It can run Codex tasks against the mounted workspace.

Use `read-only` sandbox for normal n8n calls. Use `workspace-write` only when the workflow should allow file edits inside `/workspace`.

## Docker Compose

Main compose file:

```text
docker-compose.container.yml
```

It uses the published GHCR image:

```yaml
image: ghcr.io/stanshchukin/codex-n8n-bridge:latest
```

To restart:

```powershell
docker compose -f .\docker-compose.container.yml up -d
```

To view logs:

```powershell
docker logs codex-n8n-bridge
```

## Build And Publish

Build locally:

```powershell
$BRIDGE_DIR = "path\to\codex-n8n-bridge"
cd $BRIDGE_DIR
docker build -t codex-n8n-bridge:local -t ghcr.io/stanshchukin/codex-n8n-bridge:latest .
```

Push image:

```powershell
docker push ghcr.io/stanshchukin/codex-n8n-bridge:latest
```

GitHub repo:

```text
https://github.com/StanShchukin/codex-n8n-bridge
```

## Troubleshooting

If `/health` does not respond:

```powershell
docker ps --filter name=codex-n8n-bridge
docker logs codex-n8n-bridge
```

If n8n cannot connect:

```text
Use http://host.docker.internal:8787 from n8n Docker.
Use http://localhost:8787 from Windows.
```

If `/codex/exec` returns auth errors:

```powershell
docker exec codex-n8n-bridge codex login status
.\login-container.ps1
```

If Codex is slow, raise:

```json
{
  "timeoutSeconds": 300
}
```

If MCP startup causes problems, keep:

```json
{
  "disableMcp": true
}
```

## Alternative WSL Mode

The repository also contains `server_wsl.py` and `start-wsl-bridge.ps1` for running the bridge in Ubuntu WSL instead of Docker. The Docker container setup above is the current recommended API setup for n8n.
