#!/usr/bin/env python3
import json
import os
import pathlib
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = os.environ.get("CODEX_BRIDGE_HOST", "0.0.0.0")
PORT = int(os.environ.get("CODEX_BRIDGE_PORT", "8787"))
TOKEN = os.environ.get("CODEX_BRIDGE_TOKEN")
DEFAULT_CWD = pathlib.Path(os.environ.get("CODEX_BRIDGE_CWD", os.getcwd())).resolve()
CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
CODEX_HOME = os.environ.get("CODEX_HOME") or str(pathlib.Path.home() / ".codex")
DISABLE_MCP = os.environ.get("CODEX_BRIDGE_DISABLE_MCP", "1") != "0"
MAX_PROMPT_CHARS = int(os.environ.get("CODEX_BRIDGE_MAX_PROMPT_CHARS", "12000"))
DEFAULT_TIMEOUT = int(os.environ.get("CODEX_BRIDGE_TIMEOUT_SECONDS", "600"))


def send_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def path_inside(parent, candidate):
    parent = pathlib.Path(parent).resolve()
    candidate = pathlib.Path(candidate).resolve()
    return candidate == parent or parent in candidate.parents


class CodexBridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def do_GET(self):
        if self.path == "/health":
            send_json(self, 200, {"ok": True, "service": "codex-n8n-bridge-wsl"})
            return
        send_json(self, 404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if self.path != "/codex/exec":
            send_json(self, 404, {"ok": False, "error": "Not found"})
            return

        if self.headers.get("x-codex-bridge-token") != TOKEN:
            send_json(self, 401, {"ok": False, "error": "Unauthorized"})
            return

        try:
            length = int(self.headers.get("content-length", "0"))
            if length > MAX_PROMPT_CHARS + 4096:
                send_json(self, 413, {"ok": False, "error": "Request body is too large"})
                return
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except Exception as exc:
            send_json(self, 400, {"ok": False, "error": f"Invalid JSON body: {exc}"})
            return

        prompt = str(body.get("prompt", "")).strip()
        if not prompt:
            send_json(self, 400, {"ok": False, "error": "Missing prompt"})
            return
        if len(prompt) > MAX_PROMPT_CHARS:
            send_json(self, 413, {"ok": False, "error": "Prompt is too long"})
            return

        cwd = pathlib.Path(body.get("cwd") or DEFAULT_CWD).resolve()
        if not path_inside(DEFAULT_CWD, cwd):
            send_json(self, 400, {"ok": False, "error": f"cwd must be inside {DEFAULT_CWD}"})
            return

        sandbox = str(body.get("sandbox") or "read-only")
        timeout = int(body.get("timeoutSeconds") or DEFAULT_TIMEOUT)
        args = [CODEX_BIN, "exec"]
        if bool(body.get("disableMcp", DISABLE_MCP)):
            args.extend(["-c", "mcp_servers={}"])
        args.extend(["--sandbox", sandbox, "--skip-git-repo-check", prompt])

        try:
            env = os.environ.copy()
            env["CODEX_HOME"] = CODEX_HOME
            result = subprocess.run(
                args,
                cwd=str(cwd),
                text=True,
                capture_output=True,
                stdin=subprocess.DEVNULL,
                timeout=timeout,
                env=env,
            )
            send_json(
                self,
                200 if result.returncode == 0 else 500,
                {
                    "ok": result.returncode == 0,
                    "exitCode": result.returncode,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                },
            )
        except subprocess.TimeoutExpired as exc:
            send_json(
                self,
                504,
                {
                    "ok": False,
                    "exitCode": None,
                    "stdout": exc.stdout or "",
                    "stderr": f"Timed out after {timeout} seconds",
                },
            )
        except Exception as exc:
            send_json(self, 500, {"ok": False, "exitCode": None, "stdout": "", "stderr": str(exc)})


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("Missing CODEX_BRIDGE_TOKEN")
    print(f"Codex WSL bridge listening on http://{HOST}:{PORT}")
    print(f"Default cwd: {DEFAULT_CWD}")
    print(f"CODEX_HOME: {CODEX_HOME}")
    print(f"Disable MCP by default: {DISABLE_MCP}")
    ThreadingHTTPServer((HOST, PORT), CodexBridgeHandler).serve_forever()
