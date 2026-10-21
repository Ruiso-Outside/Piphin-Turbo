// Piphin Turbo · limpeza de lixo. Só pastas de lixo conhecidas (temporários, caches, relatórios de erro);
// nunca documentos, downloads, senhas, histórico ou cookies. Arquivos em uso e recentes ficam.
const path = require("path");
const sys = require("./sys");

const E = (k) => sys.env(k);
const LOCAL = E("LOCALAPPDATA"), ROAM = E("APPDATA"), WIN = sys.SYS, PD = E("ProgramData") || "C:\\ProgramData";
const DAY = 24 * 3600 * 1000;

// cada categoria: pastas (padrões com *), se precisa de administrador, se vem marcada e o texto para leigos
const CATS = [
  { id: "temp", name: "Arquivos temporários", icon: "file", def: true, admin: false, minAge: DAY, skipRecentDirs: true,
    desc: "Arquivos que os programas criam para uso rápido e esquecem de apagar. Os do último dia e as pastas que algum programa está usando ficam.",
    dirs: () => [E("TEMP") || path.join(LOCAL, "Temp")] },
  { id: "wintemp", name: "Temporários do Windows", icon: "folder", def: true, admin: true, minAge: DAY, skipRecentDirs: true,
    desc: "A pasta Temp do próprio Windows. Precisa de permissão de administrador.",
    dirs: () => [path.join(WIN, "Temp")] },
  { id: "browsers", name: "Cache dos navegadores", icon: "globe", def: true, admin: false,
    desc: "Cópias de páginas e imagens guardadas pelo Chrome, Edge, Brave, Opera e Firefox. Senhas, histórico, favoritos e logins NÃO são apagados. Os sites podem abrir um pouco mais devagar na primeira vez.",
    dirs: () => [
      ...["Google\\Chrome", "Microsoft\\Edge", "BraveSoftware\\Brave-Browser", "Vivaldi"].flatMap((b) => ["Cache", "Code Cache", "GPUCache"].map((c) => `${LOCAL}\\${b}\\User Data\\*\\${c}`)),
      ...["Opera Software\\Opera Stable", "Opera Software\\Opera GX Stable"].flatMap((b) => ["Cache", "Code Cache", "GPUCache"].map((c) => `${LOCAL}\\${b}\\${c}`)),
      `${LOCAL}\\Mozilla\\Firefox\\Profiles\\*\\cache2`,
    ] },
  { id: "apps", name: "Cache de aplicativos", icon: "app-window", def: true, admin: false,
    desc: "Cache do Discord, da Steam (páginas da loja) e do Microsoft Teams. Nenhuma conversa ou jogo é apagado.",
    dirs: () => [
      ...["discord", "discordptb", "discordcanary"].flatMap((d) => ["Cache", "Code Cache", "GPUCache"].map((c) => `${ROAM}\\${d}\\${c}`)),
      `${LOCAL}\\Steam\\htmlcache`, `${ROAM}\\Microsoft\\Teams\\Cache`, `${ROAM}\\Microsoft\\Teams\\GPUCache`,
    ] },
  { id: "update", name: "Downloads antigos do Windows Update", icon: "download", def: true, admin: true,
    desc: "Instaladores de atualizações que já foram aplicadas. O Windows baixa de novo se precisar.",
    dirs: () => [path.join(WIN, "SoftwareDistribution\\Download"), path.join(WIN, "ServiceProfiles\\NetworkService\\AppData\\Local\\Microsoft\\Windows\\DeliveryOptimization\\Cache")] },
  { id: "errors", name: "Relatórios de erro e despejos de memória", icon: "triangle-alert", def: true, admin: true,
    desc: "Relatórios que o Windows guarda quando um programa trava. Só servem para técnicos.",
    dirs: () => [`${LOCAL}\\CrashDumps`, `${LOCAL}\\Microsoft\\Windows\\WER\\ReportArchive`, `${LOCAL}\\Microsoft\\Windows\\WER\\ReportQueue`,
      `${PD}\\Microsoft\\Windows\\WER\\ReportArchive`, `${PD}\\Microsoft\\Windows\\WER\\ReportQueue`, path.join(WIN, "Minidump")] },
  { id: "shaders", name: "Cache de shaders dos jogos", icon: "gamepad-2", def: false, admin: false,
    desc: "Arquivos que a placa de vídeo prepara para os jogos. Apagar libera espaço, mas o primeiro jogo depois pode engasgar um pouco enquanto refaz. Use se algum jogo estiver com gráficos estranhos.",
    dirs: () => [`${LOCAL}\\D3DSCache`, `${LOCAL}\\NVIDIA\\DXCache`, `${LOCAL}\\NVIDIA\\GLCache`, `${LOCAL}\\AMD\\DxCache`, `${LOCAL}\\AMD\\DxcCache`, `${LOCAL}\\AMD\\GLCache`] },
  { id: "recycle", name: "Lixeira", icon: "trash-2", def: false, admin: false, special: "recycle",
    desc: "Esvazia a Lixeira. O que está lá some de vez, então confira antes se não tem nada que você queira.",
    dirs: () => [] },
];

const dirsOf = (c) => c.dirs().flatMap((d) => (d.includes("*") ? sys.globDirs(d) : [d])).filter(sys.exists);

async function recycleSize() {
  const r = await sys.psJson(`$s = (New-Object -ComObject Shell.Application).NameSpace(10); $n = 0; $b = 0; foreach ($i in $s.Items()) { $n++; try { $b += [int64]$i.ExtendedProperty('Size') } catch {} }; @{ files = $n; bytes = $b }`, 30000).catch(() => null);
  return r || { files: 0, bytes: 0 };
}

// tamanho de cada categoria (só leitura)
async function scan(onProgress = () => {}) {
  const out = [];
  for (const c of CATS) {
    onProgress(c.id);
    let bytes = 0, files = 0;
    if (c.special === "recycle") ({ bytes, files } = await recycleSize());
    else for (const d of dirsOf(c)) { const r = await sys.dirSize(d, { minAgeMs: c.minAge || 0, skipRecentDirs: !!c.skipRecentDirs }); bytes += r.bytes; files += r.files; }
    out.push({ id: c.id, name: c.name, icon: c.icon, desc: c.desc, admin: c.admin, def: c.def, bytes, files });
  }
  return out;
}

// limpa as categorias pedidas que não precisam de administrador; devolve o que ficou para o modo administrador
async function clean(ids, { baseOverride = null } = {}) {
  const res = { bytes: 0, files: 0, skipped: 0, adminJobs: [], details: {} };
  for (const id of ids) {
    const c = CATS.find((x) => x.id === id);
    if (!c) continue;
    if (c.special === "recycle") {
      const before = await recycleSize();
      await sys.psRun("Clear-RecycleBin -Force -ErrorAction SilentlyContinue", 120000);
      res.bytes += before.bytes; res.files += before.files; res.details[id] = before.bytes;
      continue;
    }
    const dirs = baseOverride ? [baseOverride] : dirsOf(c);
    if (c.admin) { res.adminJobs.push({ id, dirs, minAgeMs: c.minAge || 0, skipRecentDirs: !!c.skipRecentDirs }); continue; }
    let b = 0;
    for (const d of dirs) { const r = await sys.cleanDir(d, { minAgeMs: c.minAge || 0, skipRecentDirs: !!c.skipRecentDirs }); b += r.bytes; res.files += r.files; res.skipped += r.skipped; }
    res.bytes += b; res.details[id] = b;
  }
  return res;
}

module.exports = { CATS, scan, clean, dirsOf };
