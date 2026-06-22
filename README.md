# Codex n8n Bridge

This small local bridge lets n8n call Codex CLI.

## Current recommended setup

Use the WSL bridge:

```text
n8n Docker -> http://host.docker.internal:8787 -> Ubuntu WSL -> codex exec
```

This path was tested successfully with n8n running in Docker and Codex CLI running inside Ubuntu WSL.

## WSL bridge

This is usually the nicest local setup if Codex CLI is already installed in Ubuntu WSL.

By default, the bridge uses the current WSL user's Codex auth from:

```text
~/.codex
```

The WSL bridge also disables MCP servers for `codex exec` by default. This avoids loading Windows-only MCP paths from `/mnt/c/Users/stanislav.shchukin/.codex/config.toml` when the bridge runs in Ubuntu WSL.

If your working Codex auth is stored in another folder, set `CODEX_HOME` when starting the bridge:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/c/Users/stanislav.shchukin/Documents/Codex/2026-06-18/hej-co-masz-za-przegl-darke && export CODEX_HOME=$HOME/.codex && export CODEX_BRIDGE_TOKEN=codex-local-test && export CODEX_BRIDGE_CWD=$PWD && python3 outputs/codex-n8n-bridge/server_wsl.py'
```

If you use ChatGPT auth from the Windows Codex desktop app, start the WSL bridge with Windows Codex auth:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/c/Users/stanislav.shchukin/Documents/Codex/2026-06-18/hej-co-masz-za-przegl-darke && export CODEX_HOME=/mnt/c/Users/stanislav.shchukin/.codex && export CODEX_BRIDGE_TOKEN=codex-local-test && export CODEX_BRIDGE_CWD=$PWD && export CODEX_BRIDGE_DISABLE_MCP=1 && python3 outputs/codex-n8n-bridge/server_wsl.py'
```

You can also start the same recommended setup with:

```powershell
.\outputs\codex-n8n-bridge\start-wsl-bridge.ps1
```

Check WSL auth directly:

```powershell
wsl.exe -d Ubuntu -- bash -lc "codex login status"
```

Check that the auth really works, not only that a login record exists:

```powershell
wsl.exe -d Ubuntu -- bash -lc "cd /mnt/c/Users/stanislav.shchukin/Documents/Codex/2026-06-18/hej-co-masz-za-przegl-darke && CODEX_HOME=/mnt/c/Users/stanislav.shchukin/.codex codex exec -c 'mcp_servers={}' --sandbox read-only --skip-git-repo-check 'Say OK only.'"
```

### Auth without device code

Option A, keep the key only in the bridge process environment:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/c/Users/stanislav.shchukin/Documents/Codex/2026-06-18/hej-co-masz-za-przegl-darke && export CODEX_BRIDGE_TOKEN=codex-local-test && export CODEX_BRIDGE_CWD=$PWD && export CODEX_API_KEY=your_api_key_here && python3 outputs/codex-n8n-bridge/server_wsl.py'
```

Option B, persist login inside WSL:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'read -s -p "OpenAI API key: " KEY; echo; printf "%s" "$KEY" | codex login --with-api-key'
```

Option C, if your workspace supports Codex access tokens:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'read -s -p "Codex access token: " TOKEN; echo; printf "%s" "$TOKEN" | codex login --with-access-token'
```

Start from PowerShell:

```powershell
wsl.exe -d Ubuntu -- bash -lc 'cd /mnt/c/Users/stanislav.shchukin/Documents/Codex/2026-06-18/hej-co-masz-za-przegl-darke && export CODEX_BRIDGE_TOKEN=codex-local-test && export CODEX_BRIDGE_CWD=$PWD && python3 outputs/codex-n8n-bridge/server_wsl.py'
```

Leave this terminal open while n8n is using the bridge.

Health check from Windows:

```powershell
curl.exe http://localhost:8787/health
```

From n8n Docker use:

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
  "prompt": "Say briefly whether Codex works with n8n.",
  "sandbox": "read-only",
  "disableMcp": true,
  "timeoutSeconds": 120
}
```

Expected successful response:

```json
{
  "ok": true,
  "exitCode": 0,
  "stdout": "OK\n"
}
```

## Docker sidecar

This is optional. The WSL bridge above is the currently tested setup.

Copy the example env file:

```powershell
cd "C:\Users\stanislav.shchukin\Documents\Codex\2026-06-18\hej-co-masz-za-przegl-darke\outputs\codex-n8n-bridge"
copy .env.example .env
```

Edit `.env` and set:

```text
CODEX_BRIDGE_TOKEN=your-local-token
CODEX_API_KEY=your-openai-or-codex-api-key
```

Build and start:

```powershell
docker compose up -d --build
```

If this compose file is not merged into the same compose project as n8n, call it from n8n with:

```text
http://host.docker.internal:8787/codex/exec
```

If you put `codex-bridge` in the same Docker Compose network as n8n, call it with:

```text
http://codex-bridge:8787/codex/exec
```

## Docker container

Use this when you want the bridge to run as a normal Docker service. It stores Codex auth in a Docker volume named `codex-n8n-bridge`, not in your Windows or WSL Codex auth.

Login Codex inside the container:

```powershell
.\outputs\codex-n8n-bridge\login-container.ps1
```

Start the bridge:

```powershell
.\outputs\codex-n8n-bridge\start-container.ps1
```

The bridge is exposed on Windows port `8787`.

Health check:

```powershell
curl.exe http://localhost:8787/health
```

From n8n Docker use:

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
  "sandbox": "read-only",
  "disableMcp": true,
  "timeoutSeconds": 180
}
```

## Start on Windows PowerShell

This is optional. Use it only if you want to run the bridge directly on Windows instead of WSL.

```powershell
cd "C:\Users\stanislav.shchukin\Documents\Codex\2026-06-18\hej-co-masz-za-przegl-darke\outputs\codex-n8n-bridge"
$env:CODEX_BRIDGE_TOKEN = "change-me-local-token"
$env:CODEX_BRIDGE_CWD = "C:\Users\stanislav.shchukin\Documents\Codex\2026-06-18\hej-co-masz-za-przegl-darke"
node .\server.js
```

Health check from Windows:

```powershell
curl.exe http://localhost:8787/health
```

Health check from n8n Docker:

```text
http://host.docker.internal:8787/health
```

## n8n HTTP Request node

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
  "prompt": "Summarize this repository in 5 bullets.",
  "sandbox": "read-only",
  "disableMcp": true,
  "timeoutSeconds": 120
}
```

For edit-capable Codex runs, use:

```json
{
  "prompt": "Create a small README improvement and explain the change.",
  "sandbox": "workspace-write",
  "disableMcp": true,
  "timeoutSeconds": 300
}
```

The bridge only allows `cwd` values inside `CODEX_BRIDGE_CWD`.

## Troubleshooting

If `/health` does not respond, the bridge is not running. Start the WSL bridge again with the PowerShell command above.

If `/codex/exec` returns an auth error, check Codex login inside WSL:

```powershell
wsl.exe -d Ubuntu -- bash -lc "codex login status"
```

If n8n cannot connect but Windows can, keep using this URL from inside n8n Docker:

```text
http://host.docker.internal:8787/codex/exec
```
