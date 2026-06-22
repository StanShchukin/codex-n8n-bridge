$ErrorActionPreference = "Stop"

$bridgeDirWindows = Resolve-Path $PSScriptRoot
$workspaceWindows = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$bridgeDir = (wsl.exe -d Ubuntu -- wslpath -a "$bridgeDirWindows").Trim()
$workspace = (wsl.exe -d Ubuntu -- wslpath -a "$workspaceWindows").Trim()
$bridgeToken = "codex-local-test"

if ($env:CODEX_HOME_WSL) {
  $codexHomeExport = "export CODEX_HOME='$($env:CODEX_HOME_WSL)'"
} else {
  $codexHomeExport = 'export CODEX_HOME=$HOME/.codex'
}

wsl.exe -d Ubuntu -- bash -lc "cd '$bridgeDir' && $codexHomeExport && export CODEX_BRIDGE_TOKEN='$bridgeToken' && export CODEX_BRIDGE_CWD='$workspace' && export CODEX_BRIDGE_DISABLE_MCP=1 && python3 server_wsl.py"
