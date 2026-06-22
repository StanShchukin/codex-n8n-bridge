$ErrorActionPreference = "Stop"

Push-Location "$PSScriptRoot"
try {
  docker compose -f docker-compose.chatgpt-auth.yml up -d --build
} finally {
  Pop-Location
}
