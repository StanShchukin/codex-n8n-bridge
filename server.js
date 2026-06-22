const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const PORT = Number(process.env.CODEX_BRIDGE_PORT || 8787);
const HOST = process.env.CODEX_BRIDGE_HOST || "0.0.0.0";
const TOKEN = process.env.CODEX_BRIDGE_TOKEN;
const DEFAULT_CWD = process.env.CODEX_BRIDGE_CWD || process.cwd();
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const DISABLE_MCP = process.env.CODEX_BRIDGE_DISABLE_MCP === "1";
const MAX_PROMPT_CHARS = Number(process.env.CODEX_BRIDGE_MAX_PROMPT_CHARS || 12000);
const DEFAULT_TIMEOUT_MS = Number(process.env.CODEX_BRIDGE_TIMEOUT_MS || 10 * 60 * 1000);

if (!TOKEN) {
  console.error("Missing CODEX_BRIDGE_TOKEN. Set it before starting the bridge.");
  process.exit(1);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_PROMPT_CHARS + 4096) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function isPathInside(parent, candidate) {
  const parentPath = path.resolve(parent).toLowerCase();
  const candidatePath = path.resolve(candidate).toLowerCase();
  return candidatePath === parentPath || candidatePath.startsWith(parentPath + path.sep);
}

function runCodex({ prompt, cwd, sandbox, timeoutMs, disableMcp }) {
  return new Promise((resolve) => {
    const runCwd = cwd ? path.resolve(cwd) : path.resolve(DEFAULT_CWD);
    if (!isPathInside(DEFAULT_CWD, runCwd)) {
      resolve({
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: `cwd must be inside ${DEFAULT_CWD}`,
      });
      return;
    }

    const args = ["exec"];
    if (disableMcp ?? DISABLE_MCP) {
      args.push("-c", "mcp_servers={}");
    }
    args.push("--sandbox", sandbox || "read-only", "--skip-git-repo-check", prompt);
    const child = spawn(CODEX_BIN, args, {
      cwd: runCwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += `\nTimed out after ${timeoutMs || DEFAULT_TIMEOUT_MS} ms`;
    }, timeoutMs || DEFAULT_TIMEOUT_MS);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, stdout, stderr: String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, stdout, stderr });
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    sendJson(res, 200, {
      ok: true,
      service: "codex-n8n-bridge",
      endpoints: {
        health: "GET /health",
        exec: "POST /codex/exec",
      },
    });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, service: "codex-n8n-bridge" });
    return;
  }

  if (req.method !== "POST" || req.url !== "/codex/exec") {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  if (req.headers["x-codex-bridge-token"] !== TOKEN) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    const body = await readJson(req);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      sendJson(res, 400, { ok: false, error: "Missing prompt" });
      return;
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      sendJson(res, 413, { ok: false, error: "Prompt is too long" });
      return;
    }

    const result = await runCodex({
      prompt,
      cwd: body.cwd,
      sandbox: body.sandbox,
      timeoutMs: body.timeoutMs,
      disableMcp: body.disableMcp,
    });
    sendJson(res, result.ok ? 200 : 500, result);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: String(error.message || error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Codex n8n bridge listening on http://${HOST}:${PORT}`);
  console.log(`Default cwd: ${path.resolve(DEFAULT_CWD)}`);
  console.log(`Disable MCP by default: ${DISABLE_MCP}`);
});
