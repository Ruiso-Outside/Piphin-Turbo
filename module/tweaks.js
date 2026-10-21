// Piphin Turbo · otimizações para jogos. Cada uma lê o estado atual, aplica e guarda o valor original para desfazer.
// Só ajustes conhecidos e seguros do próprio Windows (nada de "mágica" que pode estragar o sistema).
const sys = require("./sys");

const HIGH = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", BALANCED = "381b4222-f694-41f0-9685-ff5bb260df2e", ULTIMATE = "e9a42b02-d5df-448d-aa00-03f14749eb61";

// valores de registro de cada otimização: [chave, nome, tipo, valor desejado]
const REG = {
  gamemode: [["HKCU\\Software\\Microsoft\\GameBar", "AutoGameModeEnabled", "REG_DWORD", 1], ["HKCU\\Software\\Microsoft\\GameBar", "AllowAutoGameMode", "REG_DWORD", 1]],
  gamedvr: [["HKCU\\System\\GameConfigStore", "GameDVR_Enabled", "REG_DWORD", 0], ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR", "AppCaptureEnabled", "REG_DWORD", 0]],
  hags: [["HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers", "HwSchMode", "REG_DWORD", 2]],
  mouse: [["HKCU\\Control Panel\\Mouse", "MouseSpeed", "REG_SZ", "0"], ["HKCU\\Control Panel\\Mouse", "MouseThreshold1", "REG_SZ", "0"], ["HKCU\\Control Panel\\Mouse", "MouseThreshold2", "REG_SZ", "0"]],
  visual: [["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects", "VisualFXSetting", "REG_DWORD", 2], ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "EnableTransparency", "REG_DWORD", 0]],
  bgapps: [["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications", "GlobalUserDisabled", "REG_DWORD", 1]],
  priority: [["HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile", "SystemResponsiveness", "REG_DWORD", 10],
    ["HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games", "GPU Priority", "REG_DWORD", 8],
    ["HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games", "Priority", "REG_DWORD", 6],
    ["HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile\\Tasks\\Games", "Scheduling Category", "REG_SZ", "High"]],
};

const TWEAKS = [
  { id: "power", name: "Plano de energia de alto desempenho", icon: "zap", impact: "alto", admin: false, recommended: true,
    desc: "O processador deixa de economizar energia e responde mais rápido nos jogos. Em notebook, use na tomada (gasta mais bateria)." },
  { id: "gamemode", name: "Modo de Jogo do Windows", icon: "gamepad-2", impact: "médio", admin: false, recommended: true,
    desc: "O Windows dá prioridade ao jogo aberto e evita instalar atualizações e mostrar avisos enquanto você joga." },
  { id: "gamedvr", name: "Desligar a gravação em segundo plano", icon: "film", impact: "médio", admin: false, recommended: true,
    desc: "O Windows grava os últimos minutos dos jogos o tempo todo (Xbox Game Bar), o que consome desempenho. Desligar não impede de gravar quando você quiser." },
  { id: "windowed", name: "Otimizações para jogos em janela", icon: "app-window", impact: "médio", admin: false, recommended: true,
    desc: "Jogos em janela ou em tela cheia sem borda passam a usar o modo rápido do DirectX: menos atraso e mais FPS." },
  { id: "hags", name: "Agendamento de GPU acelerado por hardware", icon: "monitor", impact: "médio", admin: true, reboot: true, recommended: true,
    desc: "A placa de vídeo organiza o próprio trabalho, o que reduz o atraso. Precisa de placa recente (NVIDIA GTX 1000 / AMD RX 5000 ou mais nova) e de reiniciar o PC." },
  { id: "priority", name: "Prioridade para jogos", icon: "flame", impact: "baixo", admin: true, recommended: true,
    desc: "Diz ao Windows para reservar menos processador para tarefas em segundo plano e dar prioridade à placa de vídeo nos jogos." },
  { id: "mouse", name: "Mira precisa (sem aceleração do mouse)", icon: "mouse-pointer-2", impact: "médio", admin: false, recommended: true, gamer: true,
    desc: "Desliga a \"precisão do ponteiro\": o mouse anda sempre a mesma distância para o mesmo movimento. Essencial em jogos de tiro; no começo o mouse pode parecer diferente." },
  { id: "visual", name: "Efeitos visuais leves", icon: "sparkles", impact: "baixo", admin: false, recommended: false,
    desc: "Desliga animações e transparências do Windows. Ajuda em PCs fracos; nos fortes, quase não muda nada. A aparência fica mais simples." },
  { id: "bgapps", name: "Bloquear apps em segundo plano", icon: "layers", impact: "baixo", admin: false, recommended: false,
    desc: "Impede que apps da Microsoft Store fiquem rodando escondidos. Alguns podem parar de mostrar notificações." },
];

// ---------------------------------------------------------------- estado atual
async function activeScheme() {
  const r = await sys.run(sys.exe("powercfg.exe"), ["/getactivescheme"]);
  const m = /([0-9a-f]{8}-[0-9a-f-]{27})\s*\((.*)\)/i.exec(r.out);
  return m ? { guid: m[1].toLowerCase(), name: m[2] } : null;
}
async function schemes() {
  const r = await sys.run(sys.exe("powercfg.exe"), ["/list"]);
  return [...r.out.matchAll(/([0-9a-f]{8}-[0-9a-f-]{27})\s*\((.*?)\)/gi)].map((m) => ({ guid: m[1].toLowerCase(), name: m[2] }));
}
const isPerfScheme = (s) => s && (s.guid === HIGH || s.guid === ULTIMATE || /alto desempenho|high performance|desempenho m[aá]ximo|ultimate/i.test(s.name));

async function windowedOn() {
  const v = await sys.regGet("HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences", "DirectXUserGlobalSettings");
  return !!(v && /SwapEffectUpgradeEnable=1/.test(v.value));
}
async function regOn(id) {
  for (const [k, n, , want] of REG[id]) {
    const v = await sys.regGet(k, n);
    if (!v || String(v.value) !== String(want)) return false;
  }
  return true;
}
async function state() {
  const out = {};
  const sch = await activeScheme();
  out.power = { on: isPerfScheme(sch), detail: sch ? sch.name : "?" };
  out.windowed = { on: await windowedOn() };
  for (const id of Object.keys(REG)) out[id] = { on: await regOn(id) };
  // padrões do Windows quando o valor não existe: Modo de Jogo vem ligado; a gravação vem desligada na maioria dos PCs
  const gm = await sys.regGet("HKCU\\Software\\Microsoft\\GameBar", "AutoGameModeEnabled");
  if (!gm) out.gamemode.on = true;
  const dvr = await sys.regGet("HKCU\\System\\GameConfigStore", "GameDVR_Enabled"), cap = await sys.regGet("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR", "AppCaptureEnabled");
  out.gamedvr.on = !((dvr && dvr.value === 1) || (cap && cap.value === 1));
  return out;
}

// ---------------------------------------------------------------- aplicar e desfazer
// devolve { done, backup, adminActions }: o que precisa de administrador vai para o ajudante elevado
async function apply(id, { prefix = null } = {}) {
  const k = (key) => (prefix ? key.replace(/^HK(CU|LM)\\/, prefix + "\\$1\\") : key);
  if (id === "power") {
    const cur = await activeScheme();
    let target = (await schemes()).find((s) => s.guid === HIGH) || (await schemes()).find(isPerfScheme);
    if (!target) { // notebooks modernos escondem o "Alto desempenho": cria uma cópia
      const r = await sys.run(sys.exe("powercfg.exe"), ["-duplicatescheme", HIGH]);
      const m = /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(r.out);
      if (m) target = { guid: m[1].toLowerCase() };
    }
    if (!target) throw new Error("Este PC não tem o plano de alto desempenho");
    await sys.run(sys.exe("powercfg.exe"), ["/setactive", target.guid]);
    return { backup: { type: "power", guid: cur && cur.guid } };
  }
  if (id === "windowed") {
    const key = k("HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences"), cur = await sys.regGet(key, "DirectXUserGlobalSettings");
    const val = cur ? (/SwapEffectUpgradeEnable=\d/.test(cur.value) ? cur.value.replace(/SwapEffectUpgradeEnable=\d/, "SwapEffectUpgradeEnable=1") : cur.value.replace(/;?$/, ";") + "SwapEffectUpgradeEnable=1;") : "SwapEffectUpgradeEnable=1;";
    await sys.regSet(key, "DirectXUserGlobalSettings", "REG_SZ", val);
    return { backup: { type: "reg", items: [{ key, name: "DirectXUserGlobalSettings", old: cur }] } };
  }
  const items = [], adminActions = [];
  for (const [key0, name, type, value] of REG[id]) {
    const key = k(key0);
    const old = await sys.regGet(key, name);
    items.push({ key, name, old });
    if (key.startsWith("HKLM") && !prefix) adminActions.push({ type: "reg", key, name, kind: type, value });
    else await sys.regSet(key, name, type, value);
  }
  if (id === "mouse" && !prefix) await applyMouseNow(false);
  return { backup: { type: "reg", items }, adminActions };
}
async function revert(backup, { mouse = false } = {}) {
  const adminActions = [];
  if (!backup) return { adminActions };
  if (backup.type === "power" && backup.guid) await sys.run(sys.exe("powercfg.exe"), ["/setactive", backup.guid]);
  if (backup.type === "reg") for (const it of backup.items) {
    if (it.key.startsWith("HKLM")) adminActions.push(it.old ? { type: "reg", key: it.key, name: it.name, kind: it.old.type, value: it.old.value } : { type: "regdel", key: it.key, name: it.name });
    else if (it.old) await sys.regSet(it.key, it.name, it.old.type, it.old.value);
    else await sys.regDel(it.key, it.name);
  }
  if (mouse) await applyMouseNow(true);
  return { adminActions };
}
// o Windows só lê a aceleração do mouse ao entrar: avisa agora (SystemParametersInfo)
async function applyMouseNow(accel) {
  const v = accel ? "6,10,1" : "0,0,0";
  await sys.psRun(`Add-Type -Name M -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SystemParametersInfo(int a, int b, int[] c, int d);'; [W.M]::SystemParametersInfo(4, 0, [int[]](${v}), 3) | Out-Null`, 20000);
}

module.exports = { TWEAKS, REG, state, apply, revert, activeScheme, schemes, isPerfScheme, BALANCED, HIGH };
