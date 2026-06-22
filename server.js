const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.CODEX_BRIDGE_PORT || 8787);
const HOST = process.env.CODEX_BRIDGE_HOST || "0.0.0.0";
const TOKEN = process.env.CODEX_BRIDGE_TOKEN;
const DEFAULT_CWD = process.env.CODEX_BRIDGE_CWD || process.cwd();
const CODEX_BIN = process.env.CODEX_BIN || "codex";
const DISABLE_MCP = process.env.CODEX_BRIDGE_DISABLE_MCP === "1";
const MAX_PROMPT_CHARS = Number(process.env.CODEX_BRIDGE_MAX_PROMPT_CHARS || 12000);
const DEFAULT_TIMEOUT_MS = Number(process.env.CODEX_BRIDGE_TIMEOUT_MS || 10 * 60 * 1000);
const COMMAND_TIMEOUT_MS = Number(process.env.CODEX_BRIDGE_COMMAND_TIMEOUT_MS || 30 * 1000);
const BASE_CODEX_HOME = process.env.CODEX_BRIDGE_HOME || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const ACCOUNTS_DIR = path.join(BASE_CODEX_HOME, "accounts");
const ACCOUNTS_FILE = path.join(BASE_CODEX_HOME, "bridge-accounts.json");
const ACCOUNT_NAME_RE = /^[A-Za-z0-9_-]{1,48}$/;

let loginProcess = null;
let loginState = {
  running: false,
  exitCode: null,
  stdout: "",
  stderr: "",
  startedAt: null,
  finishedAt: null,
  accountName: null,
};
let activeCodexRuns = 0;

if (!TOKEN) {
  console.error("Missing CODEX_BRIDGE_TOKEN. Set it before starting the bridge.");
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

function ensureAccountStore() {
  fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    saveAccounts({
      activeAccount: "default",
      accounts: {
        default: {
          name: "default",
          note: "",
          createdAt: nowIso(),
          updatedAt: nowIso(),
          lastStatus: null,
        },
      },
    });
  }
  const state = loadAccounts();
  if (!state.accounts || Object.keys(state.accounts).length === 0) {
    state.accounts = {
      default: {
        name: "default",
        note: "",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastStatus: null,
      },
    };
    state.activeAccount = "default";
    saveAccounts(state);
  }
  if (!state.activeAccount || !state.accounts[state.activeAccount]) {
    state.activeAccount = Object.keys(state.accounts)[0];
    saveAccounts(state);
  }
  for (const accountName of Object.keys(state.accounts)) {
    fs.mkdirSync(getAccountHome(accountName), { recursive: true });
  }
}

function loadAccounts() {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  } catch {
    return { activeAccount: "default", accounts: {} };
  }
}

function saveAccounts(state) {
  fs.mkdirSync(BASE_CODEX_HOME, { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function validateAccountName(name) {
  const accountName = String(name || "").trim();
  if (!ACCOUNT_NAME_RE.test(accountName)) {
    throw new Error("Account name must use only letters, numbers, dash, or underscore, max 48 chars");
  }
  return accountName;
}

function getAccountHome(accountName) {
  return path.join(ACCOUNTS_DIR, validateAccountName(accountName));
}

function getActiveAccountName() {
  const state = loadAccounts();
  return state.activeAccount || "default";
}

function getAccount(accountName) {
  const state = loadAccounts();
  const selected = validateAccountName(accountName || state.activeAccount || "default");
  if (!state.accounts[selected]) {
    throw new Error(`Unknown account: ${selected}`);
  }
  return { state, accountName: selected, account: state.accounts[selected] };
}

function isBusy() {
  return loginState.running || activeCodexRuns > 0;
}

function publicAccounts(state) {
  return Object.values(state.accounts || {}).sort((a, b) => a.name.localeCompare(b.name));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function hasValidToken(req) {
  return req.headers["x-codex-bridge-token"] === TOKEN;
}

function requireToken(req, res) {
  if (!hasValidToken(req)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

function runCommand(args, { timeoutMs = COMMAND_TIMEOUT_MS, accountName } = {}) {
  return new Promise((resolve) => {
    const accountHome = getAccountHome(accountName || getActiveAccountName());
    const child = spawn(CODEX_BIN, args, {
      cwd: path.resolve(DEFAULT_CWD),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: accountHome },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += `\nTimed out after ${timeoutMs} ms`;
    }, timeoutMs);

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

function runProgram(command, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: path.resolve(DEFAULT_CWD),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += `\nTimed out after ${timeoutMs} ms`;
    }, timeoutMs);

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

function renderUi() {
  const localTokenHint = TOKEN === "codex-local-test" ? TOKEN : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Codex n8n Bridge</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, Segoe UI, Arial, sans-serif; background: #111; color: #eee; }
    body { margin: 0; padding: 24px; }
    main { max-width: 1040px; margin: 0 auto; display: grid; gap: 16px; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    h1 { margin: 0; font-size: 24px; }
    h2 { margin: 0 0 12px; font-size: 16px; }
    section { border: 1px solid #333; border-radius: 8px; padding: 16px; background: #181818; }
    label { display: block; margin: 10px 0 6px; color: #bbb; font-size: 13px; }
    input, textarea, select { box-sizing: border-box; width: 100%; border: 1px solid #3a3a3a; border-radius: 6px; background: #101010; color: #f4f4f4; padding: 10px; font: inherit; }
    textarea { min-height: 108px; resize: vertical; }
    button { border: 1px solid #555; border-radius: 6px; background: #242424; color: #fff; padding: 9px 12px; cursor: pointer; }
    button:hover { background: #303030; }
    button.danger { border-color: #6f3434; color: #ffd8d8; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .pill { display: inline-flex; align-items: center; border: 1px solid #444; border-radius: 999px; padding: 4px 9px; font-size: 12px; color: #ddd; }
    .notice { border-color: #61502a; background: #1f1a10; color: #f2dca2; }
    .account-list { display: grid; gap: 8px; margin-top: 12px; }
    .account-item { border: 1px solid #303030; border-radius: 6px; padding: 10px; display: grid; gap: 8px; background: #141414; }
    .account-item.active { border-color: #5f8a5f; background: #142014; }
    .account-title { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    pre { overflow: auto; background: #0b0b0b; border: 1px solid #2b2b2b; border-radius: 6px; padding: 12px; white-space: pre-wrap; word-break: break-word; }
    .muted { color: #aaa; }
    @media (max-width: 760px) { body { padding: 14px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Codex n8n Bridge</h1>
      <span class="pill">localhost:8787</span>
    </header>

    <section>
      <h2>Access</h2>
      <label for="token">Bridge token</label>
      <input id="token" type="password" placeholder="X-Codex-Bridge-Token" />
      <div class="row" style="margin-top: 10px;">
        <button onclick="saveToken()">Save token</button>
        ${localTokenHint ? '<button onclick="useLocalToken()">Use local test token</button>' : ''}
        <button onclick="loadStatus()">Refresh status</button>
        <button onclick="logout()">Logout Codex</button>
      </div>
      <p id="tokenHint" class="muted">API calls need the same token as <code>X-Codex-Bridge-Token</code>.</p>
    </section>

    <section>
      <h2>Accounts</h2>
      <div class="grid">
        <div>
          <label for="accountName">New account name</label>
          <input id="accountName" placeholder="main, test, client-a" />
        </div>
        <div>
          <label for="accountNote">Limit note</label>
          <input id="accountNote" placeholder="manual note, e.g. low limit" />
        </div>
      </div>
      <div class="row" style="margin-top: 10px;">
        <button onclick="createAccount()">Create account</button>
        <button onclick="loadAccounts()">Refresh accounts</button>
      </div>
      <div id="accounts" class="account-list">Not loaded.</div>
    </section>

    <div class="grid">
      <section>
        <h2>Status</h2>
        <pre id="status">Not loaded.</pre>
      </section>

      <section>
        <h2>Login</h2>
        <p class="muted">Starts <code>codex login --device-auth</code> inside the container. Copy the device code from output, open the shown URL, and finish login.</p>
        <div class="row">
          <button onclick="startLogin()">Start login for active account</button>
          <button onclick="loadLoginStatus()">Refresh login output</button>
          <button onclick="cancelLogin()">Cancel login</button>
        </div>
        <pre id="login">No login process started.</pre>
      </section>
    </div>

    <section>
      <h2>Codex CLI Update</h2>
      <p class="muted">This updates Codex CLI inside the currently running container. It is useful for testing, but a container recreate from the published image can revert it. For a persistent update, rebuild and push the Docker image.</p>
      <div class="row">
        <button onclick="updateCodex()">Update Codex CLI</button>
      </div>
      <pre id="update">No update run yet.</pre>
    </section>

    <section>
      <h2>Test Codex Exec</h2>
      <label for="prompt">Prompt</label>
      <textarea id="prompt">Say OK only.</textarea>
      <div class="grid">
        <div>
          <label for="sandbox">Sandbox</label>
          <select id="sandbox">
            <option value="read-only">read-only</option>
            <option value="workspace-write">workspace-write</option>
          </select>
        </div>
        <div>
          <label for="timeout">Timeout seconds</label>
          <input id="timeout" type="number" min="10" value="180" />
        </div>
      </div>
      <div class="row" style="margin-top: 10px;">
        <button onclick="runExec()">Run</button>
      </div>
      <pre id="exec">No run yet.</pre>
    </section>
  </main>

  <script>
    const tokenInput = document.getElementById("token");
    let activeAccount = "default";
    const localTokenHint = ${JSON.stringify(localTokenHint)};
    tokenInput.value = localStorage.getItem("codexBridgeToken") || localTokenHint || "";

    function saveToken() {
      localStorage.setItem("codexBridgeToken", tokenInput.value);
      loadStatus();
    }

    function useLocalToken() {
      tokenInput.value = localTokenHint;
      saveToken();
    }

    function token() {
      return tokenInput.value || localStorage.getItem("codexBridgeToken") || "";
    }

    async function api(path, options = {}) {
      if (!token()) {
        return {
          status: 0,
          body: {
            ok: false,
            error: "Missing bridge token",
            hint: localTokenHint
              ? "Click Use local test token or enter codex-local-test."
              : "Enter the bridge token and click Save token."
          }
        };
      }
      const headers = Object.assign({ "X-Codex-Bridge-Token": token() }, options.headers || {});
      const res = await fetch(path, Object.assign({}, options, { headers }));
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); }
      catch { body = text; }
      if (res.status === 401) {
        return {
          status: res.status,
          body: {
            ok: false,
            error: "Unauthorized",
            hint: "Bridge token is missing or incorrect. Save the current token and try again.",
            response: body
          }
        };
      }
      return { status: res.status, body };
    }

    function show(id, value) {
      document.getElementById(id).textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[ch]));
    }

    async function loadAccounts() {
      const result = await api("/api/accounts");
      if (!result.body || !result.body.ok) {
        document.getElementById("accounts").textContent = JSON.stringify(result, null, 2);
        return;
      }
      activeAccount = result.body.activeAccount;
      const accounts = result.body.accounts || [];
      document.getElementById("accounts").innerHTML = accounts.map((account) => {
        const isActive = account.name === activeAccount;
        const status = account.lastStatus
          ? [account.lastStatus.stdout, account.lastStatus.stderr].filter(Boolean).join(" ").trim()
          : "No status checked yet.";
        return \`
          <div class="account-item \${isActive ? "active" : ""}">
            <div class="account-title">
              <strong>\${escapeHtml(account.name)}</strong>
              <span class="pill">\${isActive ? "active" : "available"}</span>
            </div>
            <input id="note-\${escapeHtml(account.name)}" value="\${escapeHtml(account.note || "")}" placeholder="manual limit note" />
            <div class="row">
              <button onclick="selectAccount('\${escapeHtml(account.name)}')">Use</button>
              <button onclick="startLogin('\${escapeHtml(account.name)}')">Login</button>
              <button onclick="logout('\${escapeHtml(account.name)}')">Logout</button>
              <button onclick="saveAccountNote('\${escapeHtml(account.name)}')">Save note</button>
              <button class="danger" onclick="deleteAccount('\${escapeHtml(account.name)}')">Delete</button>
            </div>
            <span class="muted">\${escapeHtml(status)}</span>
          </div>
        \`;
      }).join("");
    }

    async function createAccount() {
      const body = {
        accountName: document.getElementById("accountName").value,
        note: document.getElementById("accountNote").value
      };
      show("status", await api("/api/accounts/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }));
      await loadAccounts();
    }

    async function selectAccount(accountName) {
      show("status", await api("/api/accounts/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName })
      }));
      await loadAccounts();
      await loadStatus();
    }

    async function deleteAccount(accountName) {
      show("status", await api("/api/accounts/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName })
      }));
      await loadAccounts();
      await loadStatus();
    }

    async function saveAccountNote(accountName) {
      const note = document.getElementById("note-" + accountName).value;
      show("status", await api("/api/accounts/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName, note })
      }));
      await loadAccounts();
    }

    async function loadStatus() {
      const result = await api("/api/status");
      if (result.body && result.body.activeAccount) activeAccount = result.body.activeAccount;
      show("status", result);
      await loadAccounts();
    }

    async function startLogin(accountName = activeAccount) {
      show("login", await api("/api/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName })
      }));
      setTimeout(loadLoginStatus, 1000);
    }

    async function loadLoginStatus() {
      show("login", await api("/api/login/status"));
    }

    async function cancelLogin() {
      show("login", await api("/api/login/cancel", { method: "POST" }));
    }

    async function logout(accountName = activeAccount) {
      show("status", await api("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountName })
      }));
      await loadStatus();
    }

    async function updateCodex() {
      show("update", "Updating... this can take a minute.");
      show("update", await api("/api/update-codex", { method: "POST" }));
      await loadStatus();
    }

    async function runExec() {
      const body = {
        prompt: document.getElementById("prompt").value,
        sandbox: document.getElementById("sandbox").value,
        disableMcp: true,
        accountName: activeAccount,
        timeoutSeconds: Number(document.getElementById("timeout").value || 180)
      };
      show("exec", "Running...");
      show("exec", await api("/codex/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      }));
    }

    if (token()) {
      loadAccounts();
      loadStatus();
    } else {
      show("status", {
        ok: false,
        error: "Missing bridge token",
        hint: localTokenHint
          ? "Click Use local test token."
          : "Enter the bridge token and click Save token."
      });
    }
  </script>
</body>
</html>`;
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

function runCodex({ prompt, cwd, sandbox, timeoutMs, disableMcp, accountName }) {
  return new Promise((resolve) => {
    let selectedAccount;
    let accountHome;
    try {
      selectedAccount = getAccount(accountName).accountName;
      accountHome = getAccountHome(selectedAccount);
    } catch (error) {
      resolve({ ok: false, exitCode: null, stdout: "", stderr: String(error.message || error) });
      return;
    }
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
    activeCodexRuns += 1;
    const child = spawn(CODEX_BIN, args, {
      cwd: runCwd,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: accountHome },
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
      activeCodexRuns = Math.max(0, activeCodexRuns - 1);
      resolve({ ok: false, exitCode: null, stdout, stderr: String(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      activeCodexRuns = Math.max(0, activeCodexRuns - 1);
      resolve({ ok: code === 0, exitCode: code, accountName: selectedAccount, stdout, stderr });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && req.url === "/") {
    sendJson(res, 200, {
      ok: true,
      service: "codex-n8n-bridge",
      endpoints: {
        health: "GET /health",
        ui: "GET /ui",
        accounts: "GET /api/accounts",
        status: "GET /api/status",
        exec: "POST /codex/exec",
      },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/ui") {
    sendHtml(res, 200, renderUi());
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: "codex-n8n-bridge" });
    return;
  }

  if (url.pathname === "/api/accounts" && req.method === "GET") {
    if (!requireToken(req, res)) return;
    const state = loadAccounts();
    sendJson(res, 200, {
      ok: true,
      activeAccount: state.activeAccount,
      accounts: publicAccounts(state),
      busy: { login: loginState.running, codexRuns: activeCodexRuns },
    });
    return;
  }

  if (url.pathname === "/api/accounts/create" && req.method === "POST") {
    if (!requireToken(req, res)) return;
    try {
      const body = await readJson(req);
      const accountName = validateAccountName(body.accountName);
      const state = loadAccounts();
      if (state.accounts[accountName]) {
        sendJson(res, 409, { ok: false, error: "Account already exists" });
        return;
      }
      state.accounts[accountName] = {
        name: accountName,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : "",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastStatus: null,
      };
      if (!state.activeAccount) state.activeAccount = accountName;
      fs.mkdirSync(getAccountHome(accountName), { recursive: true });
      saveAccounts(state);
      sendJson(res, 201, { ok: true, activeAccount: state.activeAccount, accounts: publicAccounts(state) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error.message || error) });
    }
    return;
  }

  if (url.pathname === "/api/accounts/select" && req.method === "POST") {
    if (!requireToken(req, res)) return;
    if (isBusy()) {
      sendJson(res, 409, { ok: false, error: "Cannot switch account while login or codex exec is running" });
      return;
    }
    try {
      const body = await readJson(req);
      const { state, accountName } = getAccount(body.accountName);
      state.activeAccount = accountName;
      state.accounts[accountName].updatedAt = nowIso();
      saveAccounts(state);
      sendJson(res, 200, { ok: true, activeAccount: accountName, accounts: publicAccounts(state) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error.message || error) });
    }
    return;
  }

  if (url.pathname === "/api/accounts/delete" && req.method === "POST") {
    if (!requireToken(req, res)) return;
    if (isBusy()) {
      sendJson(res, 409, { ok: false, error: "Cannot delete account while login or codex exec is running" });
      return;
    }
    try {
      const body = await readJson(req);
      const accountName = validateAccountName(body.accountName);
      const state = loadAccounts();
      if (!state.accounts[accountName]) {
        sendJson(res, 404, { ok: false, error: "Account not found" });
        return;
      }
      if (Object.keys(state.accounts).length === 1) {
        sendJson(res, 409, { ok: false, error: "Cannot delete the last account" });
        return;
      }
      delete state.accounts[accountName];
      fs.rmSync(getAccountHome(accountName), { recursive: true, force: true });
      if (state.activeAccount === accountName) {
        state.activeAccount = Object.keys(state.accounts)[0];
      }
      saveAccounts(state);
      sendJson(res, 200, { ok: true, activeAccount: state.activeAccount, accounts: publicAccounts(state) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error.message || error) });
    }
    return;
  }

  if (url.pathname === "/api/accounts/note" && req.method === "POST") {
    if (!requireToken(req, res)) return;
    try {
      const body = await readJson(req);
      const { state, accountName } = getAccount(body.accountName);
      state.accounts[accountName].note = typeof body.note === "string" ? body.note.slice(0, 500) : "";
      state.accounts[accountName].updatedAt = nowIso();
      saveAccounts(state);
      sendJson(res, 200, { ok: true, activeAccount: state.activeAccount, accounts: publicAccounts(state) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error.message || error) });
    }
    return;
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    if (!requireToken(req, res)) return;
    const state = loadAccounts();
    const activeAccount = state.activeAccount;
    const login = await runCommand(["login", "status"], { accountName: activeAccount });
    const version = await runCommand(["--version"], { accountName: activeAccount });
    state.accounts[activeAccount].lastStatus = {
      checkedAt: nowIso(),
      ok: login.ok,
      stdout: login.stdout,
      stderr: login.stderr,
    };
    state.accounts[activeAccount].updatedAt = nowIso();
    saveAccounts(state);
    sendJson(res, 200, {
      ok: true,
      service: "codex-n8n-bridge",
      cwd: path.resolve(DEFAULT_CWD),
      codexBin: CODEX_BIN,
      disableMcpDefault: DISABLE_MCP,
      activeAccount,
      accounts: publicAccounts(state),
      version,
      login,
      busy: { login: loginState.running, codexRuns: activeCodexRuns },
      loginProcess: {
        running: loginState.running,
        exitCode: loginState.exitCode,
        startedAt: loginState.startedAt,
        finishedAt: loginState.finishedAt,
        accountName: loginState.accountName,
      },
    });
    return;
  }

  if (url.pathname === "/api/update-codex" && req.method === "POST") {
    if (!requireToken(req, res)) return;
    const before = await runCommand(["--version"]);
    const update = await runProgram("npm", ["install", "-g", "@openai/codex@latest"]);
    const after = await runCommand(["--version"]);
    sendJson(res, update.ok ? 200 : 500, {
      ok: update.ok,
      note: "This updates the currently running container only. Rebuild the image for a persistent update.",
      before,
      update,
      after,
    });
    return;
  }

  if (url.pathname === "/api/login/start" && req.method === "POST") {
    if (!requireToken(req, res)) return;
    if (loginState.running) {
      sendJson(res, 409, { ok: false, error: "Login already running", login: loginState });
      return;
    }
    let body = {};
    try {
      body = await readJson(req);
    } catch {
      body = {};
    }
    let selectedAccount;
    let accountHome;
    try {
      selectedAccount = getAccount(body.accountName).accountName;
      accountHome = getAccountHome(selectedAccount);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error.message || error) });
      return;
    }

    loginState = {
      running: true,
      exitCode: null,
      stdout: "",
      stderr: "",
      startedAt: nowIso(),
      finishedAt: null,
      accountName: selectedAccount,
    };

    loginProcess = spawn(CODEX_BIN, ["login", "--device-auth"], {
      cwd: path.resolve(DEFAULT_CWD),
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CODEX_HOME: accountHome },
    });

    loginProcess.stdout.on("data", (data) => {
      loginState.stdout += data.toString();
    });
    loginProcess.stderr.on("data", (data) => {
      loginState.stderr += data.toString();
    });
    loginProcess.on("error", (error) => {
      loginState.running = false;
      loginState.exitCode = null;
      loginState.stderr += String(error);
      loginState.finishedAt = nowIso();
      loginProcess = null;
    });
    loginProcess.on("close", (code) => {
      loginState.running = false;
      loginState.exitCode = code;
      loginState.finishedAt = nowIso();
      loginProcess = null;
    });

    sendJson(res, 202, { ok: true, login: loginState });
    return;
  }

  if (url.pathname === "/api/login/status" && req.method === "GET") {
    if (!requireToken(req, res)) return;
    sendJson(res, 200, { ok: true, login: loginState });
    return;
  }

  if (url.pathname === "/api/login/cancel" && req.method === "POST") {
    if (!requireToken(req, res)) return;
    if (loginProcess && loginState.running) {
      loginProcess.kill("SIGTERM");
      loginState.running = false;
      loginState.finishedAt = nowIso();
      sendJson(res, 200, { ok: true, message: "Login process cancelled", login: loginState });
      return;
    }
    sendJson(res, 200, { ok: true, message: "No login process running", login: loginState });
    return;
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    if (!requireToken(req, res)) return;
    let body = {};
    try {
      body = await readJson(req);
    } catch {
      body = {};
    }
    let accountName;
    try {
      accountName = getAccount(body.accountName).accountName;
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error.message || error) });
      return;
    }
    const result = await runCommand(["logout"], { accountName });
    sendJson(res, result.ok ? 200 : 500, result);
    return;
  }

  if (req.method !== "POST" || url.pathname !== "/codex/exec") {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return;
  }

  if (!requireToken(req, res)) return;

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
      timeoutMs: body.timeoutMs || (body.timeoutSeconds ? Number(body.timeoutSeconds) * 1000 : undefined),
      disableMcp: body.disableMcp,
      accountName: body.accountName,
    });
    sendJson(res, result.ok ? 200 : 500, result);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: String(error.message || error) });
  }
});

ensureAccountStore();

server.listen(PORT, HOST, () => {
  console.log(`Codex n8n bridge listening on http://${HOST}:${PORT}`);
  console.log(`Default cwd: ${path.resolve(DEFAULT_CWD)}`);
  console.log(`Disable MCP by default: ${DISABLE_MCP}`);
  console.log(`Codex account store: ${ACCOUNTS_DIR}`);
});
