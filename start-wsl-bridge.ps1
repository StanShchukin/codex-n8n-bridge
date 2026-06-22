$ErrorActionPreference = "Stop"

$workspace = "/mnt/c/Users/stanislav.shchukin/Documents/Codex/2026-06-18/hej-co-masz-za-przegl-darke"
$codexHome = "/mnt/c/Users/stanislav.shchukin/.codex"
$bridgeToken = "codex-local-test"

wsl.exe -d Ubuntu -- bash -lc "cd '$workspace' && export CODEX_HOME='$codexHome' && export CODEX_BRIDGE_TOKEN='$bridgeToken' && export CODEX_BRIDGE_CWD=`$PWD && export CODEX_BRIDGE_DISABLE_MCP=1 && python3 outputs/codex-n8n-bridge/server_wsl.py"
