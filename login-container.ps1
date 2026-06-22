$ErrorActionPreference = "Stop"

Push-Location "$PSScriptRoot"
try {
  docker compose -f docker-compose.container.yml run --rm codex-n8n-bridge codex login --device-auth
} finally {
  Pop-Location
}
