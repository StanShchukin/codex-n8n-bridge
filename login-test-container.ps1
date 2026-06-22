$ErrorActionPreference = "Stop"

Push-Location "$PSScriptRoot"
try {
  docker compose -f docker-compose.chatgpt-auth.yml run --rm --service-ports codex-bridge-test codex login --device-auth
} finally {
  Pop-Location
}
