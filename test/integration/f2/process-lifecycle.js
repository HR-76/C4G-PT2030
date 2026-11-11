const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");
const tempRoot = path.join(repoRoot, ".tmp", "f2-integration");

function loadEnvironment() {
  const values = {};
  for (const line of fs.readFileSync(path.join(tempRoot, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return { ...process.env, ...values };
}

function specification(name) {
  if (name === "api") return {
    name,
    cwd: path.join(repoRoot, "backend"),
    args: [path.join(repoRoot, "backend", "src", "server.js")],
    healthUrl: "http://127.0.0.1:5000/health/db",
    port: 5000,
    commandMarker: "src\\server.js"
  };
  if (name === "frontend") return {
    name,
    cwd: path.join(repoRoot, "frontend"),
    args: [path.join(repoRoot, "frontend", "node_modules", "vite", "bin", "vite.js"), "--host", "0.0.0.0", "--port", "3100"],
    healthUrl: "http://127.0.0.1:3100/",
    port: 3100,
    commandMarker: "vite.js"
  };
  throw new Error(`Unknown process: ${name}`);
}

function metadataPath(name) { return path.join(tempRoot, `${name}-process.json`); }

function normalizedPath(value) {
  return path.resolve(String(value)).replace(/\//g, "\\").toLowerCase();
}

function normalizedArgument(value) {
  const argument = String(value);
  return path.isAbsolute(argument)
    ? normalizedPath(argument)
    : argument.replace(/\//g, "\\").toLowerCase();
}

function specificationHash(spec) {
  return crypto.createHash("sha256").update(JSON.stringify({
    executable: normalizedPath(process.execPath),
    cwd: normalizedPath(spec.cwd),
    args: spec.args.map(normalizedArgument)
  })).digest("hex");
}

function processDetails(pid) {
  const script = `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction SilentlyContinue; if($p){[pscustomobject]@{ProcessId=$p.ProcessId;CreationEpochMs=([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds();ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine} | ConvertTo-Json -Compress}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  return JSON.parse(result.stdout);
}

function listenerOwnedBy(port, pid) {
  const script = `$listeners=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue); if($listeners | Where-Object OwningProcess -eq ${pid}){exit 0}else{exit 1}`;
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true }).status === 0;
}

function validateMetadata(name, { requireListener = true } = {}) {
  const spec = specification(name);
  const metadata = JSON.parse(fs.readFileSync(metadataPath(name), "utf8"));
  if (metadata.name !== name
    || normalizedPath(metadata.executable) !== normalizedPath(process.execPath)
    || normalizedPath(metadata.cwd) !== normalizedPath(spec.cwd)
    || JSON.stringify(metadata.args.map(normalizedArgument)) !== JSON.stringify(spec.args.map(normalizedArgument))
    || metadata.specificationHash !== specificationHash(spec)) {
    throw new Error(`${name} metadata does not match the immutable process specification.`);
  }
  const details = processDetails(metadata.pid);
  if (!details) throw new Error(`${name} process is not alive.`);
  if (normalizedPath(details.ExecutablePath || "") !== normalizedPath(process.execPath)) throw new Error(`${name} executable does not match Node.`);
  const observedCommand = String(details.CommandLine || "").replace(/\//g, "\\").toLowerCase();
  if (spec.args.some(argument => !observedCommand.includes(normalizedArgument(argument)))) {
    throw new Error(`${name} command does not match the immutable specification.`);
  }
  const observedStart = Number(details.CreationEpochMs);
  if (!Number.isFinite(observedStart) || Math.abs(observedStart - metadata.startedAtEpochMs) > 5000) {
    throw new Error(`${name} start time does not match metadata.`);
  }
  if (requireListener && !listenerOwnedBy(spec.port, metadata.pid)) {
    throw new Error(`${name} does not own its expected listener.`);
  }
  return metadata;
}

function requestStatus(url) {
  return new Promise(resolve => {
    const request = http.get(url, response => { response.resume(); resolve(response.statusCode || 0); });
    request.on("error", () => resolve(0));
    request.setTimeout(2000, () => { request.destroy(); resolve(0); });
  });
}

async function waitReady(spec, pid, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processDetails(pid)) throw new Error(`${spec.name} exited before readiness.`);
    const status = await requestStatus(spec.healthUrl);
    if (status >= 200 && status < 400 && listenerOwnedBy(spec.port, pid)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${spec.name} readiness timed out.`);
}

async function waitStopped(pid, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processDetails(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Process ${pid} did not stop.`);
}

function portIsFree(port) {
  const script = `$listener=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue; if($listener){exit 1}else{exit 0}`;
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true }).status === 0;
}

async function startOne(name) {
  const spec = specification(name);
  if (!portIsFree(spec.port)) throw new Error(`${name} port is not free; no process was terminated.`);
  const stdoutPath = path.join(tempRoot, `${name}.stdout.log`);
  const stderrPath = path.join(tempRoot, `${name}.stderr.log`);
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  const startedAtEpochMs = Date.now();
  const child = spawn(process.execPath, spec.args, {
    cwd: spec.cwd,
    env: loadEnvironment(),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr]
  });
  const metadata = {
    name,
    pid: child.pid,
    startedAtEpochMs,
    executable: process.execPath,
    args: spec.args,
    cwd: spec.cwd,
    specificationHash: specificationHash(spec),
    ready: false,
    stdoutPath,
    stderrPath
  };
  fs.writeFileSync(metadataPath(name), JSON.stringify(metadata, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    await waitReady(spec, child.pid);
    metadata.ready = true;
    fs.writeFileSync(metadataPath(name), JSON.stringify(metadata, null, 2), { encoding: "utf8", mode: 0o600 });
    validateMetadata(name);
    return metadata;
  } catch (error) {
    if (processDetails(child.pid)) {
      try {
        validateMetadata(name, { requireListener: false });
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        await waitStopped(child.pid);
      } catch { /* preserve the startup failure without selecting another process */ }
    }
    throw error;
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    child.unref();
  }
}

async function stopOne(name) {
  if (!fs.existsSync(metadataPath(name))) return;
  const recorded = JSON.parse(fs.readFileSync(metadataPath(name), "utf8"));
  if (!processDetails(recorded.pid)) {
    if (!portIsFree(specification(name).port)) throw new Error(`${name} recorded process is dead but its port is occupied; no process was terminated.`);
    fs.rmSync(metadataPath(name), { force: true });
    return;
  }
  const metadata = validateMetadata(name, { requireListener: recorded.ready === true });
  const result = spawnSync("taskkill.exe", ["/PID", String(metadata.pid), "/T", "/F"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 && processDetails(metadata.pid)) throw new Error(`${name} process tree could not be stopped.`);
  await waitStopped(metadata.pid);
  if (!portIsFree(specification(name).port)) throw new Error(`${name} port remained occupied; no other process was terminated.`);
  fs.rmSync(metadataPath(name), { force: true });
}

async function main() {
  const action = process.argv[2];
  if (action === "start-all") { await startOne("api"); await startOne("frontend"); return; }
  if (action === "stop-all") {
    const failures = [];
    for (const name of ["frontend", "api"]) {
      try { await stopOne(name); } catch (error) { failures.push(`${name}: ${error.message}`); }
    }
    if (failures.length > 0) throw new Error(failures.join(" "));
    return;
  }
  if (action === "restart-api") { const old = validateMetadata("api").pid; await stopOne("api"); const fresh = await startOne("api"); if (fresh.pid === old) throw new Error("API PID did not rotate."); return; }
  if (action === "verify") { validateMetadata("api"); validateMetadata("frontend"); return; }
  throw new Error("Usage: process-lifecycle.js start-all|stop-all|restart-api|verify");
}

main().then(() => console.log("F2 process lifecycle action completed.")).catch(error => {
  console.error(`F2 process lifecycle action failed: ${error.message}`);
  process.exitCode = 1;
});
