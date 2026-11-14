// Piphin Turbo no Linux: as mesmas peças do Windows (lixo, ajustes, inicialização, programas abertos, administrador),
// com o que existe no Linux (Zorin, Ubuntu e derivados):
//   lixo           caches do usuário (miniaturas, navegadores, Discord, Steam), /tmp, pacotes baixados do apt, registros antigos
//   ajustes        perfil de energia (power-profiles-daemon), mouse sem aceleração e animações (GNOME), swappiness, GameMode
//   inicialização  ~/.config/autostart e /etc/xdg/autostart (desligar grava uma cópia sua com X-GNOME-Autostart-enabled=false)
//   administrador  um pedido de senha só (pkexec), pelo linux-helper.py
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const sys = require("./sys"); // dirSize, cleanDir e exists são só Node (servem nos dois sistemas)

const HOME = os.homedir();
const DAY = 24 * 3600 * 1000;
const CACHE = process.env.XDG_CACHE_HOME || path.join(HOME, ".cache");
const CONF = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
const DATA = process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share");

function run(file, args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => execFile(file, args, { timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } }, (err, out, e) =>
    resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: String(out || ""), err: String(e || "") })));
}
const has = (cmd) => process.env.PATH.split(":").some((d) => sys.exists(path.join(d, cmd)));

// pastas com um "*" por nível (ex.: ~/.cache/google-chrome/*/Cache)
function glob(pattern) {
  const parts = pattern.split("/").filter(Boolean);
  let cur = ["/"];
  for (const part of parts) {
    const next = [];
    for (const base of cur) {
      if (part.includes("*")) {
        const re = new RegExp("^" + part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
        try { for (const e of fs.readdirSync(base, { withFileTypes: true })) if (e.isDirectory() && re.test(e.name)) next.push(path.join(base, e.name)); } catch { /* sem acesso */ }
      } else { const p = path.join(base, part); if (sys.exists(p)) next.push(p); }
    }
    cur = next;
  }
  return cur;
}

// ---------------------------------------------------------------- lixo
const chromium = (base) => ["Cache", "Code Cache", "GPUCache"].flatMap((c) => [`${CACHE}/${base}/*/${c}`, `${CONF}/${base}/*/${c}`]);
const CATS = [
  { id: "temp", name: "Arquivos temporários", icon: "file", def: true, admin: false, minAge: DAY, skipRecentDirs: true,
    desc: "Arquivos que os programas deixam na pasta /tmp. Os do último dia e as pastas que algum programa está usando ficam.",
    dirs: () => ["/tmp"] },
  { id: "thumbs", name: "Miniaturas de imagens", icon: "image", def: true, admin: false,
    desc: "Miniaturas que o gerenciador de arquivos guarda das suas fotos e vídeos. Elas são refeitas quando você abrir as pastas.",
    dirs: () => [`${CACHE}/thumbnails`] },
  { id: "browsers", name: "Cache dos navegadores", icon: "globe", def: true, admin: false,
    desc: "Cópias de páginas e imagens guardadas pelo Chrome, Brave, Edge, Vivaldi, Opera e Firefox. Senhas, histórico, favoritos e logins NÃO são apagados.",
    dirs: () => [...chromium("google-chrome"), ...chromium("chromium"), ...chromium("BraveSoftware/Brave-Browser"), ...chromium("microsoft-edge"), ...chromium("vivaldi"),
      `${CACHE}/opera`, `${CACHE}/mozilla/firefox/*/cache2`, `${HOME}/snap/firefox/common/.cache/mozilla/firefox/*/cache2`,
      `${HOME}/.var/app/org.mozilla.firefox/cache/mozilla/firefox/*/cache2`] },
  { id: "apps", name: "Cache de aplicativos", icon: "app-window", def: true, admin: false,
    desc: "Cache do Discord e das páginas da loja da Steam. Nenhuma conversa ou jogo é apagado.",
    dirs: () => [...["discord", "discordptb", "discordcanary"].flatMap((d) => ["Cache", "Code Cache", "GPUCache"].map((c) => `${CONF}/${d}/${c}`)),
      `${DATA}/Steam/config/htmlcache`, `${HOME}/.steam/steam/config/htmlcache`] },
  { id: "packages", name: "Pacotes baixados do sistema", icon: "download", def: true, admin: true, minAge: DAY,
    desc: "Instaladores (.deb) de atualizações que já foram aplicadas. O sistema baixa de novo se precisar. Pede a sua senha.",
    dirs: () => ["/var/cache/apt/archives"] },
  { id: "logs", name: "Registros antigos do sistema", icon: "scroll-text", def: true, admin: true,
    desc: "Registros (journal) com mais de 2 semanas e relatórios de travamento em /var/crash. Só servem para técnicos. Pede a sua senha.",
    dirs: () => ["/var/log/journal", "/var/crash"] },
  { id: "shaders", name: "Cache de shaders dos jogos", icon: "gamepad-2", def: false, admin: false,
    desc: "Arquivos que a placa de vídeo prepara para os jogos (Mesa, NVIDIA e os da Steam). Apagar libera espaço, mas o primeiro jogo depois pode engasgar um pouco enquanto refaz.",
    dirs: () => [`${CACHE}/mesa_shader_cache`, `${CACHE}/mesa_shader_cache_db`, `${CACHE}/nvidia/GLCache`, `${HOME}/.nv/GLCache`, `${DATA}/Steam/steamapps/shadercache`] },
  { id: "recycle", name: "Lixeira", icon: "trash-2", def: false, admin: false,
    desc: "Esvazia a Lixeira. O que está lá some de vez, então confira antes se não tem nada que você queira.",
    dirs: () => [`${DATA}/Trash/files`, `${DATA}/Trash/info`] },
];
const dirsOf = (c) => [...new Set(c.dirs().flatMap((d) => (d.includes("*") ? glob(d) : [d])).filter(sys.exists))];
async function scan(onProgress = () => {}) {
  const out = [];
  for (const c of CATS) {
    onProgress(c.id);
    let bytes = 0, files = 0;
    for (const d of dirsOf(c)) { const r = await sys.dirSize(d, { minAgeMs: c.minAge || 0, skipRecentDirs: !!c.skipRecentDirs }); bytes += r.bytes; files += r.files; }
    out.push({ id: c.id, name: c.name, icon: c.icon, desc: c.desc, admin: c.admin, def: c.def, bytes, files });
  }
  return out;
}
async function clean(ids) {
  const res = { bytes: 0, files: 0, skipped: 0, adminJobs: [], details: {} };
  for (const id of ids) {
    const c = CATS.find((x) => x.id === id);
    if (!c) continue;
    const dirs = dirsOf(c);
    if (c.admin) { res.adminJobs.push({ id, dirs, minAgeMs: c.minAge || 0 }); continue; }
    let b = 0;
    for (const d of dirs) { const r = await sys.cleanDir(d, { minAgeMs: c.minAge || 0, skipRecentDirs: !!c.skipRecentDirs }); b += r.bytes; res.files += r.files; res.skipped += r.skipped; }
    res.bytes += b; res.details[id] = b;
  }
  return res;
}
const junk = { CATS, scan, clean, dirsOf };

// ---------------------------------------------------------------- ajustes para jogos
const gget = async (schema, key) => { const r = await run("gsettings", ["get", schema, key]); return r.code === 0 ? r.out.trim() : null; };
const gset = async (schema, key, value) => { const r = await run("gsettings", ["set", schema, key, value]); if (r.code !== 0) throw new Error("Não foi possível mudar a configuração (" + (r.err.trim() || "gsettings") + ")"); };
const MOUSE = ["org.gnome.desktop.peripherals.mouse", "accel-profile"], ANIM = ["org.gnome.desktop.interface", "enable-animations"];
const SYSCTL_FILE = "/etc/sysctl.d/99-piphin-turbo.conf";

const TWEAKS = [
  { id: "power", name: "Perfil de energia de desempenho", icon: "zap", impact: "alto", admin: false, recommended: true,
    desc: "O processador deixa de economizar energia e responde mais rápido nos jogos (o mesmo que escolher \"Desempenho\" no menu de energia). Em notebook, use na tomada." },
  { id: "gamemode", name: "GameMode (Feral)", icon: "gamepad-2", impact: "médio", admin: true, recommended: true,
    desc: "Instala o GameMode: os jogos que pedem (e os da Steam com \"gamemoderun %command%\") ganham prioridade de processador e de disco enquanto rodam. Pede a sua senha." },
  { id: "swappiness", name: "Usar menos o arquivo de troca", icon: "memory-stick", impact: "médio", admin: true, recommended: true,
    desc: "O sistema passa a guardar os jogos na memória RAM em vez de mandar partes para o disco (swappiness 10). Menos engasgos quando a RAM enche. Pede a sua senha." },
  { id: "mouse", name: "Mira precisa (sem aceleração do mouse)", icon: "mouse-pointer-2", impact: "médio", admin: false, recommended: true, gamer: true,
    desc: "O mouse anda sempre a mesma distância para o mesmo movimento (perfil \"plano\"). Essencial em jogos de tiro; no começo o mouse pode parecer diferente." },
  { id: "visual", name: "Desligar as animações", icon: "sparkles", impact: "baixo", admin: false, recommended: false,
    desc: "Desliga as animações das janelas e menus. Ajuda em PCs fracos; nos fortes, quase não muda nada." },
];
const powerGet = async () => { const r = await run("powerprofilesctl", ["get"]); return r.code === 0 ? r.out.trim() : null; };
async function state() {
  const out = {};
  const p = await powerGet();
  out.power = { on: p === "performance", detail: p || "sem o power-profiles-daemon" };
  out.gamemode = { on: has("gamemoded") };
  out.swappiness = { on: Number(fs.readFileSync("/proc/sys/vm/swappiness", "utf8")) <= 20, detail: "swappiness " + fs.readFileSync("/proc/sys/vm/swappiness", "utf8").trim() };
  out.mouse = { on: (await gget(...MOUSE)) === "'flat'" };
  out.visual = { on: (await gget(...ANIM)) === "false" };
  return out;
}
async function apply(id) {
  if (id === "power") {
    const cur = await powerGet();
    if (cur == null) throw new Error("Este sistema não tem o controle de perfis de energia (power-profiles-daemon)");
    const r = await run("powerprofilesctl", ["set", "performance"]);
    if (r.code !== 0) throw new Error("Este processador não tem o perfil de desempenho");
    return { backup: { type: "power", profile: cur }, adminActions: [] };
  }
  if (id === "mouse" || id === "visual") {
    const [schema, key] = id === "mouse" ? MOUSE : ANIM;
    const old = await gget(schema, key);
    if (old == null) throw new Error("Esta área de trabalho não usa as configurações do GNOME");
    await gset(schema, key, id === "mouse" ? "flat" : "false");
    return { backup: { type: "gsettings", schema, key, old }, adminActions: [] };
  }
  if (id === "swappiness") {
    const old = fs.readFileSync("/proc/sys/vm/swappiness", "utf8").trim();
    return { backup: { type: "sysctl", old }, adminActions: [{ type: "write", file: SYSCTL_FILE, content: "# Piphin Turbo: menos uso do arquivo de troca nos jogos\nvm.swappiness=10\n" }, { type: "cmd", argv: ["sysctl", "-w", "vm.swappiness=10"] }] };
  }
  if (id === "gamemode") {
    if (has("gamemoded")) return { backup: { type: "none" }, adminActions: [] };
    return { backup: { type: "pkg", name: "gamemode" }, adminActions: [{ type: "cmd", argv: ["apt-get", "install", "-y", "gamemode"], env: { DEBIAN_FRONTEND: "noninteractive" } }] };
  }
  throw new Error("Ajuste desconhecido: " + id);
}
async function revert(backup) {
  const adminActions = [];
  if (!backup) return { adminActions };
  if (backup.type === "power" && backup.profile) await run("powerprofilesctl", ["set", backup.profile]);
  if (backup.type === "gsettings" && backup.old != null) await run("gsettings", ["set", backup.schema, backup.key, backup.old.replace(/^'|'$/g, "")]);
  if (backup.type === "sysctl") adminActions.push({ type: "remove", file: SYSCTL_FILE }, { type: "cmd", argv: ["sysctl", "-w", `vm.swappiness=${Number(backup.old) || 60}`] });
  if (backup.type === "pkg") adminActions.push({ type: "cmd", argv: ["apt-get", "remove", "-y", backup.name], env: { DEBIAN_FRONTEND: "noninteractive" } });
  return { adminActions };
}
const tweaks = { TWEAKS, state, apply, revert };

// ---------------------------------------------------------------- inicialização
const { friendly } = require("./startup");
const AUTOSTART_USER = path.join(CONF, "autostart"), AUTOSTART_SYS = "/etc/xdg/autostart";
function parseDesktop(text) {
  const o = {}; let inMain = false;
  for (const line of text.split("\n")) {
    if (/^\[/.test(line)) { inMain = line.trim() === "[Desktop Entry]"; continue; }
    const m = inMain && /^([\w-]+)=(.*)$/.exec(line.trim());
    if (m && !(m[1] in o)) o[m[1]] = m[2];
  }
  return o;
}
const desktopNow = () => String(process.env.XDG_CURRENT_DESKTOP || "").split(":").filter(Boolean);
function list() {
  const items = new Map();
  for (const [dir, source] of [[AUTOSTART_SYS, "todos"], [AUTOSTART_USER, "usuário"]]) {
    let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".desktop")); } catch { continue; }
    for (const f of files) {
      let d; try { d = parseDesktop(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
      const prev = items.get(f);
      const only = (d.OnlyShowIn || "").split(";").filter(Boolean), not = (d.NotShowIn || "").split(";").filter(Boolean);
      const shows = (!only.length || only.some((x) => desktopNow().includes(x))) && !not.some((x) => desktopNow().includes(x));
      const enabled = d.Hidden !== "true" && d["X-GNOME-Autostart-enabled"] !== "false";
      const it = { id: f, name: d.Name || f.replace(/\.desktop$/, ""), cmd: d.Exec || "", source: prev ? prev.source : source, admin: false, enabled, hidden: !shows || d.NoDisplay === "true" };
      items.set(f, it);
    }
  }
  const out = [...items.values()].filter((i) => !i.hidden);
  for (const it of out) Object.assign(it, friendly(it.name, it.cmd), { exe: (it.cmd.split(/\s+/)[0] || "").replace(/^"|"$/g, "") });
  return out;
}
// a cópia do usuário vale mais que a do sistema: desligar não apaga nada
async function setEnabled(id, enabled) {
  if (!/^[\w.@+-]+\.desktop$/.test(id)) throw new Error("Item inválido");
  const user = path.join(AUTOSTART_USER, id), sysf = path.join(AUTOSTART_SYS, id);
  let text = sys.exists(user) ? fs.readFileSync(user, "utf8") : sys.exists(sysf) ? fs.readFileSync(sysf, "utf8") : null;
  if (text == null) throw new Error("Item da inicialização não encontrado");
  text = text.replace(/^X-GNOME-Autostart-enabled=.*\n?/m, "").replace(/^Hidden=.*\n?/m, "");
  text = text.replace(/(\[Desktop Entry\][^\n]*\n)/, `$1X-GNOME-Autostart-enabled=${enabled ? "true" : "false"}\n`);
  fs.mkdirSync(AUTOSTART_USER, { recursive: true });
  fs.writeFileSync(user, text);
  return { adminActions: [] };
}

// ---------------------------------------------------------------- programas abertos (só os do próprio usuário)
const PROTECT = /^(systemd|gnome-shell|gnome-session.*|xorg|xwayland|pipewire.*|wireplumber|pulseaudio|dbus-.*|gsd-.*|ibus.*|at-spi.*|gvfs.*|evolution-.*|tracker-.*|xdg-.*|nautilus|zorin.*|mutter.*|bash|zsh|sh|fish|sudo|ssh-agent|gnome-terminal.*|tilix|piphin-hub|electron|python3?|node|gnome-keyring.*|polkit.*|snapd.*)$/i;
function processes() {
  const uid = process.getuid ? process.getuid() : -1, tick = 100, page = 4096, by = new Map();
  for (const d of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = fs.readFileSync(`/proc/${d}/status`, "utf8");
      if (Number((/^Uid:\s+(\d+)/m.exec(st) || [])[1]) !== uid) continue;
      const name = fs.readFileSync(`/proc/${d}/comm`, "utf8").trim();
      if (PROTECT.test(name) || Number(d) === process.pid) continue;
      const f = fs.readFileSync(`/proc/${d}/stat`, "utf8").replace(/^.*\) /s, "").split(" ");
      const rss = Number(fs.readFileSync(`/proc/${d}/statm`, "utf8").split(" ")[1]) * page;
      let exe = ""; try { exe = fs.readlinkSync(`/proc/${d}/exe`); } catch { /* sem acesso */ }
      const e = by.get(name) || { name, count: 0, mem: 0, cpu: 0, title: "", desc: name, path: exe, window: false, pids: [] };
      e.count++; e.mem += rss; e.cpu += (Number(f[11]) + Number(f[12])) / tick; e.pids.push(Number(d));
      by.set(name, e);
    } catch { /* fechou no meio */ }
  }
  return [...by.values()].map(({ pids, ...p }) => ({ ...p, cpu: Math.round(p.cpu * 10) / 10 })).sort((a, b) => b.mem - a.mem);
}
async function closeApp(name, force = false) {
  if (PROTECT.test(name)) throw new Error("Esse processo é do sistema e não pode ser fechado aqui");
  const r = await run("pkill", [force ? "-KILL" : "-TERM", "-x", "-u", String(process.getuid()), name]);
  return r.code === 0;
}
const startup = { list: async () => list(), setEnabled, processes: async () => processes(), closeApp, PROTECT };

// ---------------------------------------------------------------- administrador (pkexec, uma senha só)
async function runElevated(actions) {
  const res = { ok: true, actions: [] };
  // ponto de restauração não existe no Linux comum: quem quiser usa o Timeshift
  const real = actions.filter((a) => a.type !== "restorepoint");
  for (const a of actions) if (a.type === "restorepoint") res.actions.push({ type: "restorepoint", ok: false, error: "no Linux, use o Timeshift para pontos de restauração" });
  if (!real.length) return res;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "piphin-turbo-"));
  const id = crypto.randomBytes(6).toString("hex");
  const job = path.join(dir, `job-${id}.json`), out = path.join(dir, `res-${id}.json`);
  fs.writeFileSync(job, JSON.stringify({ actions: real }));
  const r = await run("pkexec", ["/usr/bin/python3", "-I", path.join(__dirname, "linux-helper.py"), job, out], { timeout: 30 * 60 * 1000 });
  try {
    if (!sys.exists(out)) return r.code === 126 || r.code === 127 ? { declined: true } : { ok: false, error: "O ajudante de administrador não respondeu (código " + r.code + ")" };
    const got = JSON.parse(fs.readFileSync(out, "utf8"));
    return { ok: true, actions: [...res.actions, ...(got.actions || [])] };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const admin = { runElevated };

// ---------------------------------------------------------------- Modo Turbo
const turbo = {
  powerGet,
  async on() { const cur = await powerGet(); if (cur != null) await run("powerprofilesctl", ["set", "performance"]); return cur; },
  async off(prev) { if (prev) await run("powerprofilesctl", ["set", prev]); },
};
function diskInfo() { try { const s = fs.statfsSync("/"); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; } }

module.exports = { junk, tweaks, startup, admin, turbo, diskInfo, glob };
