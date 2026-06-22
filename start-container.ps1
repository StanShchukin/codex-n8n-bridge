$ErrorActionPreference = "Stop"

Push-Location "$PSScriptRoot"
try {
  docker compose -f docker-compose.container.yml up -d
} finally {
  Pop-Location
}
