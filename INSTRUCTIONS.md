# Agent Handoff Instructions

Project: `codex-n8n-bridge`

Repository:

```text
https://github.com/StanShchukin/codex-n8n-bridge
```

Image:

```text
ghcr.io/stanshchukin/codex-n8n-bridge:latest
```

Purpose:

```text
Expose Codex CLI to n8n through a small HTTP API.
```

Current production-like local setup:

```text
Docker container name: codex-n8n-bridge
Host port:             8787
Container port:        8787
Auth volume:           codex-n8n-bridge
Workspace mount:       /workspace
Bridge token:          codex-local-test
```

Start:

```powershell
.\start-container.ps1
```

Login Codex inside container:

```powershell
.\login-container.ps1
```

Health:

```powershell
curl.exe http://localhost:8787/health
```

Local web panel:

```text
http://localhost:8787/ui
```

n8n endpoint:

```text
POST http://host.docker.internal:8787/codex/exec
```

n8n headers:

```text
Content-Type: application/json
X-Codex-Bridge-Token: codex-local-test
```

n8n body:

```json
{
  "prompt": "Say OK only.",
  "sandbox": "read-only",
  "disableMcp": true,
  "timeoutSeconds": 180
}
```

Expected success:

```json
{
  "ok": true,
  "exitCode": 0,
  "stdout": "OK\n",
  "stderr": "..."
}
```

Important implementation details:

```text
server.js is the Docker bridge.
server_wsl.py is an alternate WSL bridge.
docker-compose.container.yml is the primary compose file.
The root endpoint GET / returns service info.
GET /ui returns a lightweight local web panel.
GET /health returns health status.
GET /api/status returns login and Codex CLI status.
POST /api/login/start starts codex login --device-auth.
POST /api/logout logs Codex out of the container volume.
POST /api/update-codex runs npm install -g @openai/codex@latest inside the running container.
POST /codex/exec runs codex exec.
stdin is closed for codex exec to avoid hanging on extra input.
disableMcp defaults from CODEX_BRIDGE_DISABLE_MCP and can be overridden per request.
cwd must remain inside CODEX_BRIDGE_CWD.
Updating Codex CLI through /ui is temporary for the running container; rebuild the image for a durable update.
```

Recommended safety:

```text
Keep sandbox read-only by default.
Use workspace-write only for workflows that intentionally edit files.
Replace codex-local-test with a real secret before broader use.
Do not expose port 8787 publicly.
```
