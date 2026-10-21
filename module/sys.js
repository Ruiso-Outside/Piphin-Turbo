// Piphin Turbo · utilitários do sistema: rodar comandos, ler/gravar o registro (reg.exe) e PowerShell.
// Tudo com programas do próprio Windows (sem dependências nativas).
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SYS = process.env.SystemRoot || "C:\\Windows";
const exe = (name) => path.join(SYS, "System32", name);

function run(file, args, { timeout = 60000, input = null } = {}) {
  return new Promise((resolve) => {
    const p = execFile(file, args, { windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" }, (err, stdout, stderr) => {
      // saída do console em UTF-8 quando possível; reg.exe usa a página de código OEM (latin1 é suficiente para os nomes)
      const dec = (b) => { const s = b.toString("utf8"); return s.includes("\uFFFD") ? b.toString("latin1") : s; };
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: dec(stdout || Buffer.alloc(0)), err: dec(stderr || Buffer.alloc(0)) });
    });
    if (input != null) { p.stdin.write(input); p.stdin.end(); }
  });
}

// PowerShell com saída em JSON (UTF-8)
async function psJson(script, timeout = 60000) {
  const full = `$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;$r = & { ${script} };$r | ConvertTo-Json -Depth 6 -Compress`;
  const r = await run(exe("WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", full], { timeout });
  const txt = r.out.trim();
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { throw new Error("PowerShell: " + (r.err || txt).slice(0, 300)); }
}
const psRun = (script, timeout = 60000) => run(exe("WindowsPowerShell\\v1.0\\powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { timeout });

// ---------------------------------------------------------------- registro
const TYPES = ["REG_SZ", "REG_DWORD", "REG_QWORD", "REG_BINARY", "REG_EXPAND_SZ", "REG_MULTI_SZ"];
// valor de um item: { type, value } (DWORD como número) ou null se não existe
async function regGet(key, name) {
  const r = await run(exe("reg.exe"), ["query", key, ...(name == null ? ["/ve"] : ["/v", name])]);
  if (r.code !== 0) return null;
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}?(.*)$/.exec(line);
    if (!m || !TYPES.includes(m[2])) continue;
    if (name != null && m[1].toLowerCase() !== name.toLowerCase()) continue;
    const type = m[2], raw = (m[3] || "").trim();
    const value = type === "REG_DWORD" || type === "REG_QWORD" ? Number(BigInt(raw)) : raw;
    return { type, value };
  }
  return null;
}
// todos os valores de uma chave: [{ name, type, value }]
async function regList(key) {
  const r = await run(exe("reg.exe"), ["query", key]);
  if (r.code !== 0) return [];
  const out = [];
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^\s{4}(.+?)\s{4}(REG_\w+)\s{4}?(.*)$/.exec(line);
    if (m && TYPES.includes(m[2])) out.push({ name: m[1] === "(Padrão)" || m[1] === "(Default)" ? "" : m[1], type: m[2], value: m[2] === "REG_DWORD" ? Number(BigInt(m[3].trim())) : (m[3] || "").trim() });
  }
  return out;
}
const regDataArg = (type, value) => (type === "REG_DWORD" ? "0x" + (Number(value) >>> 0).toString(16) : type === "REG_QWORD" ? "0x" + BigInt(value).toString(16) : String(value));
async function regSet(key, name, type, value) {
  const r = await run(exe("reg.exe"), ["add", key, ...(name ? ["/v", name] : ["/ve"]), "/t", type, "/d", regDataArg(type, value), "/f"]);
  if (r.code !== 0) throw new Error(`Não foi possível gravar ${key}\\${name}: ${r.err.trim() || r.out.trim()}`);
}
async function regDel(key, name) {
  const r = await run(exe("reg.exe"), ["delete", key, ...(name ? ["/v", name] : []), "/f"]);
  return r.code === 0;
}

// ---------------------------------------------------------------- arquivos
// tamanho de uma pasta (com limite de tempo e de quantidade), ignorando o que não dá para ler
async function dirSize(dir, { minAgeMs = 0, deadline = Date.now() + 20000, filter = null, skipRecentDirs = false } = {}) {
  let bytes = 0, files = 0;
  const now = Date.now();
  const walk = async (d, top = false) => {
    if (Date.now() > deadline) return;
    let list;
    try { list = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (top && skipRecentDirs && (await recent(p, minAgeMs, now))) continue; await walk(p); continue; }
      if (filter && !filter(e.name)) continue;
      try { const st = await fs.promises.stat(p); if (minAgeMs && now - st.mtimeMs < minAgeMs) continue; bytes += st.size; files++; } catch { /* sumiu ou sem acesso */ }
    }
  };
  await walk(dir, true);
  return { bytes, files };
}
// apaga o conteúdo de uma pasta (não a pasta), pulando arquivos em uso e recentes
// pasta mexida há pouco = algum programa aberto pode estar usando: fica inteira
const recent = async (p, minAgeMs, now) => { try { return now - (await fs.promises.stat(p)).mtimeMs < Math.max(minAgeMs, 3600000); } catch { return true; } };
async function cleanDir(dir, { minAgeMs = 0, filter = null, skipRecentDirs = false } = {}) {
  let bytes = 0, files = 0, skipped = 0;
  const now = Date.now();
  const walk = async (d, top) => {
    let list;
    try { list = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (top && skipRecentDirs && (await recent(p, minAgeMs, now))) { skipped++; continue; }
        await walk(p, false);
        try { await fs.promises.rmdir(p); } catch { /* não vazia (algo em uso) */ }
        continue;
      }
      if (filter && !filter(e.name)) continue;
      try {
        const st = await fs.promises.stat(p);
        if (minAgeMs && now - st.mtimeMs < minAgeMs) { skipped++; continue; }
        await fs.promises.unlink(p);
        bytes += st.size; files++;
      } catch { skipped++; }
    }
    void top;
  };
  await walk(dir, true);
  return { bytes, files, skipped };
}
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
// pastas que batem com um padrão simples (um "*" por nível): C:\x\*\Cache
function globDirs(pattern) {
  const parts = pattern.split(/[\\/]+/);
  let cur = [parts.shift() + "\\"];
  for (const part of parts) {
    const next = [];
    for (const base of cur) {
      if (part.includes("*")) {
        const re = new RegExp("^" + part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
        try { for (const e of fs.readdirSync(base, { withFileTypes: true })) if (e.isDirectory() && re.test(e.name)) next.push(path.join(base, e.name)); } catch { /* sem acesso */ }
      } else { const p = path.join(base, part); if (exists(p)) next.push(p); }
    }
    cur = next;
  }
  return cur;
}
const isAdmin = async () => (await run(exe("net.exe"), ["session"], { timeout: 8000 })).code === 0;

module.exports = { run, psJson, psRun, regGet, regList, regSet, regDel, dirSize, cleanDir, globDirs, exists, isAdmin, exe, SYS, env: (k) => process.env[k] || "", home: os.homedir() };
