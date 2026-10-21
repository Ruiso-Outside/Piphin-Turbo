// Piphin Turbo · programas que abrem com o Windows e programas abertos agora.
// Ligar/desligar a inicialização usa o mesmo lugar do Gerenciador de Tarefas (StartupApproved): nada é apagado.
const fs = require("fs");
const path = require("path");
const sys = require("./sys");

const RUN_HKCU = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_HKLM = "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_HKLM32 = "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED = (hive, sub) => `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\${sub}`;
const STARTUP_USER = path.join(sys.env("APPDATA"), "Microsoft\\Windows\\Start Menu\\Programs\\Startup");
const STARTUP_ALL = path.join(sys.env("ProgramData") || "C:\\ProgramData", "Microsoft\\Windows\\Start Menu\\Programs\\StartUp");

// programas conhecidos: nome amigável e se costuma valer a pena deixar
const KNOWN = [
  [/onedrive/i, "OneDrive", "Sincroniza seus arquivos com a nuvem. Desligue se você não usa o OneDrive.", true],
  [/teams/i, "Microsoft Teams", "Só precisa abrir sozinho se você usa o Teams para trabalho ou escola.", false],
  [/discord/i, "Discord", "Abre o Discord junto com o Windows. Você pode abrir quando quiser jogar.", false],
  [/steam/i, "Steam", "Abre a Steam junto com o Windows. Dá para abrir só na hora de jogar.", false],
  [/epic/i, "Epic Games", "Abre a Epic Games Launcher junto com o Windows.", false],
  [/spotify/i, "Spotify", "Abre o Spotify junto com o Windows.", false],
  [/riot/i, "Riot Client", "Abre o cliente da Riot (Valorant, LoL). O anti-cheat do Valorant (Vanguard) é outra coisa e continua.", false],
  [/edge.*autolaunch|msedge/i, "Microsoft Edge (pré-carregar)", "Deixa o Edge pré-aberto para abrir mais rápido. Pode desligar.", false],
  [/securityhealth|windowsdefender/i, "Segurança do Windows", "Ícone do antivírus do Windows. Deixe ligado.", true],
  [/realtek|rtkaud|nahimic|audio/i, "Áudio da placa-mãe", "Painel de som da placa-mãe. Melhor deixar ligado.", true],
  [/nvidia|nvbackend|nvcontainer/i, "NVIDIA", "Serviços da placa de vídeo NVIDIA. Melhor deixar ligado.", true],
  [/amd|radeon/i, "AMD", "Serviços da AMD. Melhor deixar ligado.", true],
  [/logi|razer|corsair|steelseries|hyperx/i, "Periférico gamer", "Software do mouse/teclado/headset (luzes e macros). Deixe ligado se usa os recursos.", true],
  [/piphin/i, "Piphin", "Programas da Piphin.", true],
  [/roblox/i, "Roblox", "Abre o Roblox escondido junto com o Windows. Pode desligar.", false],
  [/whatsapp|telegram/i, "Mensagens", "App de mensagens. Desligue se não precisa dele aberto o tempo todo.", false],
  [/googledrive|google drive/i, "Google Drive", "Sincroniza arquivos com o Google Drive.", true],
  [/dropbox/i, "Dropbox", "Sincroniza arquivos com o Dropbox.", true],
];
const friendly = (name, cmd) => {
  for (const [re, nice, tip, keep] of KNOWN) if (re.test(name) || re.test(cmd)) return { nice, tip, keep };
  return { nice: name, tip: "", keep: null };
};
// bytes do StartupApproved: o primeiro byte par (02/06) = ligado; ímpar (03/07) = desligado
const enabledFrom = (hex) => (hex ? (parseInt(hex.slice(0, 2), 16) & 1) === 0 : true);
const exeOf = (cmd) => { const m = /^"([^"]+)"|^(\S+\.exe)/i.exec(String(cmd || "").trim()); return m ? m[1] || m[2] : ""; };

async function list() {
  const items = [];
  const fromReg = async (runKey, hive, sub) => {
    const vals = await sys.regList(runKey);
    const approved = await sys.regList(APPROVED(hive, sub));
    for (const v of vals) {
      if (!v.name) continue;
      const a = approved.find((x) => x.name.toLowerCase() === v.name.toLowerCase());
      items.push({ id: `${hive}|${sub}|${v.name}`, name: v.name, cmd: v.value, source: hive === "HKCU" ? "usuário" : "todos", admin: hive === "HKLM", enabled: enabledFrom(a && a.value) });
    }
  };
  await fromReg(RUN_HKCU, "HKCU", "Run");
  await fromReg(RUN_HKLM, "HKLM", "Run");
  await fromReg(RUN_HKLM32, "HKLM", "Run32");
  for (const [dir, hive] of [[STARTUP_USER, "HKCU"], [STARTUP_ALL, "HKLM"]]) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => !/^desktop\.ini$/i.test(f)); } catch { /* sem pasta */ }
    const approved = await sys.regList(APPROVED(hive, "StartupFolder"));
    for (const f of files) {
      const a = approved.find((x) => x.name.toLowerCase() === f.toLowerCase());
      items.push({ id: `${hive}|StartupFolder|${f}`, name: f.replace(/\.lnk$/i, ""), cmd: path.join(dir, f), source: "pasta Inicializar", admin: hive === "HKLM", enabled: enabledFrom(a && a.value) });
    }
  }
  for (const it of items) Object.assign(it, friendly(it.name, it.cmd), { exe: exeOf(it.cmd) });
  return items;
}
// valor binário de 12 bytes como o Gerenciador de Tarefas grava
function approvedValue(enabled) {
  if (enabled) return "020000000000000000000000";
  const ft = BigInt(Date.now()) * 10000n + 116444736000000000n, b = Buffer.alloc(8);
  b.writeBigUInt64LE(ft);
  return "03000000" + b.toString("hex");
}
// liga/desliga; itens de "todos os usuários" precisam de administrador (vão para o ajudante elevado)
async function setEnabled(id, enabled) {
  const [hive, sub, name] = id.split("|");
  const key = APPROVED(hive, sub), value = approvedValue(enabled);
  if (hive === "HKLM") return { adminActions: [{ type: "reg", key, name, kind: "REG_BINARY", value }] };
  await sys.regSet(key, name, "REG_BINARY", value);
  return { adminActions: [] };
}

// ---------------------------------------------------------------- programas abertos
// processos do sistema e do próprio Hub nunca aparecem para fechar
const PROTECT = /^(system|idle|registry|smss|csrss|wininit|winlogon|services|lsass|svchost|fontdrvhost|dwm|explorer|sihost|ctfmon|taskhostw|runtimebroker|searchhost|startmenuexperiencehost|textinputhost|shellexperiencehost|applicationframehost|securityhealthservice|securityhealthsystray|msmpeng|nissrv|audiodg|conhost|dllhost|spoolsv|wudfhost|memcompression|smartscreen|lsaiso|piphin hub|electron|powershell|cmd|windowsterminal|openconsole|vgc|vgtray|vanguard|easyanticheat.*|battleye.*|nvcontainer|nvdisplay.container|amdrsserv|atiesrxx|atieclxx|claude)$/i;
async function processes() {
  const list = await sys.psJson(`Get-Process | Where-Object { $_.Id -ne 0 -and $_.Id -ne 4 } | Group-Object ProcessName | ForEach-Object {
      $p = $_.Group; $w = ($p | Where-Object { $_.MainWindowTitle } | Select-Object -First 1)
      [pscustomobject]@{ name = $_.Name; count = $_.Count; mem = ($p | Measure-Object WorkingSet64 -Sum).Sum; cpu = [math]::Round(($p | Measure-Object CPU -Sum).Sum, 1);
        title = if ($w) { $w.MainWindowTitle } else { '' }; desc = ($p | Select-Object -First 1).Description; path = ($p | Select-Object -First 1).Path } }`, 45000);
  return (Array.isArray(list) ? list : list ? [list] : [])
    .filter((p) => !PROTECT.test(p.name) && !/\\Windows\\(System32|SysWOW64)\\/i.test(p.path || ""))
    .map((p) => ({ name: p.name, count: p.count, mem: p.mem || 0, cpu: p.cpu || 0, title: p.title || "", desc: p.desc || p.name, path: p.path || "", window: !!p.title }))
    .sort((a, b) => b.mem - a.mem);
}
// fecha educadamente (como clicar no X); force = encerra de vez
async function closeApp(name, force = false) {
  if (PROTECT.test(name)) throw new Error("Esse processo é do sistema e não pode ser fechado aqui");
  const r = await sys.run(sys.exe("taskkill.exe"), ["/IM", name + ".exe", ...(force ? ["/F"] : []), "/T"]);
  return r.code === 0;
}

module.exports = { list, setEnabled, processes, closeApp, PROTECT };
