// Piphin Turbo como módulo do Piphin Hub: check-up do PC, limpeza de lixo, otimizações para jogos (com desfazer),
// programas da inicialização, programas abertos e o "Modo Turbo" para a hora de jogar.
// Nada muda sem um clique da pessoa; pedidos da IA sempre passam por uma confirmação na tela.
const fs = require("fs");
const os = require("os");
const path = require("path");
const sys = require("./sys");
const junk = require("./junk");
const tweaks = require("./tweaks");
const startup = require("./startup");
const admin = require("./admin");

exports.activate = (ctx) => {
  const BACKUP = path.join(ctx.dataDir, "backups.json"), HISTORY = path.join(ctx.dataDir, "historico.json"), PREFS = path.join(ctx.dataDir, "prefs.json");
  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };
  let backups = readJson(BACKUP, {}); // id da otimização -> backup do valor original
  let history = readJson(HISTORY, []);
  const log = (kind, text, extra = {}) => { history = [{ at: new Date().toISOString(), kind, text, ...extra }, ...history].slice(0, 200); writeJson(HISTORY, history); ctx.emit("history", history); };
  let busy = null;
  const exclusive = async (what, fn) => {
    if (busy) throw new Error(`Aguarde: ${busy} em andamento`);
    busy = what; ctx.emit("busy", what);
    try { return await fn(); } finally { busy = null; ctx.emit("busy", null); }
  };

  // ---------------------------------------------------------------- check-up
  let lastJunk = null;
  function diskInfo() {
    try { const s = fs.statfsSync((process.env.SystemDrive || "C:") + "\\"); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return null; }
  }
  async function checkup(progress = () => {}) {
    progress("Procurando lixo...");
    const j = await junk.scan((id) => progress("Procurando lixo: " + (junk.CATS.find((c) => c.id === id) || {}).name));
    lastJunk = j;
    progress("Verificando as configurações de jogo...");
    const st = await tweaks.state();
    progress("Verificando a inicialização...");
    const su = await startup.list();
    const disk = diskInfo(), ramUsed = 1 - os.freemem() / os.totalmem();
    const findings = [];
    let score = 100;
    const junkDefault = j.filter((c) => c.def).reduce((n, c) => n + c.bytes, 0);
    if (junkDefault > 5e9) { score -= 15; } else if (junkDefault > 1e9) { score -= 8; } else if (junkDefault > 3e8) { score -= 3; }
    if (junkDefault > 1e8) findings.push({ id: "junk", level: junkDefault > 1e9 ? "alto" : "médio", title: `${fmtBytes(junkDefault)} de lixo para limpar`, text: "Arquivos temporários, caches e restos de atualizações ocupando espaço.", action: "clean" });
    const missing = tweaks.TWEAKS.filter((t) => t.recommended && !(st[t.id] || {}).on);
    for (const t of missing) score -= t.id === "power" ? 10 : t.impact === "alto" ? 8 : t.impact === "médio" ? 5 : 2;
    if (missing.length) findings.push({ id: "tweaks", level: missing.some((t) => t.impact !== "baixo") ? "alto" : "médio", title: `${missing.length} ${missing.length === 1 ? "ajuste para jogos desligado" : "ajustes para jogos desligados"}`, text: missing.map((t) => t.name).join(", "), action: "optimize" });
    const heavy = su.filter((s) => s.enabled && s.keep === false);
    const enabled = su.filter((s) => s.enabled).length;
    if (enabled > 8) score -= 10; else if (enabled > 5) score -= 5;
    if (heavy.length) findings.push({ id: "startup", level: heavy.length > 3 ? "médio" : "baixo", title: `${enabled} programas abrem com o Windows`, text: `Dá para desligar com segurança: ${heavy.map((s) => s.nice).slice(0, 5).join(", ")}${heavy.length > 5 ? "..." : ""}.`, action: "startup" });
    if (disk) {
      const pct = disk.free / disk.total;
      if (pct < 0.1) { score -= 15; findings.push({ id: "disk", level: "alto", title: `Disco do Windows quase cheio (${fmtBytes(disk.free)} livres)`, text: "Com menos de 10% livre, o Windows e os jogos ficam lentos e as atualizações falham.", action: "clean" }); }
      else if (pct < 0.2) { score -= 7; findings.push({ id: "disk", level: "médio", title: `Pouco espaço livre no disco (${fmtBytes(disk.free)})`, text: "Libere espaço apagando o lixo e jogos que você não usa mais.", action: "clean" }); }
    }
    if (ramUsed > 0.85) { score -= 8; findings.push({ id: "ram", level: "médio", title: `Memória quase cheia (${Math.round(ramUsed * 100)}% em uso)`, text: "Muitos programas abertos. Feche os que não está usando antes de jogar (aba Programas abertos).", action: "procs" }); }
    score = Math.max(5, Math.min(100, Math.round(score)));
    return { score, findings, junk: j, tweaks: st, startup: { total: su.length, enabled, heavy: heavy.length }, disk, ram: { total: os.totalmem(), used: os.totalmem() - os.freemem() }, at: new Date().toISOString() };
  }
  const fmtBytes = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1).replace(".", ",") + " GB" : b >= 1e6 ? Math.round(b / 1e6) + " MB" : Math.round(b / 1e3) + " KB");

  // ---------------------------------------------------------------- limpeza + otimizações (um pedido de administrador só)
  // ordem: 1) ponto de restauração e tudo o que precisa de administrador, de uma vez (um UAC);
  //        2) limpeza e ajustes de usuário comum. Se a permissão for recusada, só a parte de administrador fica de fora.
  async function optimize({ clean = [], tweakIds = [], restorePoint = false } = {}) {
    const res = { bytes: 0, files: 0, skipped: 0, done: [], failed: [], reboot: false, declined: false, restorePoint: null };
    const adminT = [], userT = [], pendingBackups = {}, actions = [];
    for (const id of tweakIds) { const t = tweaks.TWEAKS.find((x) => x.id === id); if (t) (t.admin ? adminT : userT).push(t); }
    // ajustes de administrador: só leem o valor atual (para desfazer) e viram ações do ajudante
    for (const t of adminT) {
      try { const r = await tweaks.apply(t.id); pendingBackups[t.id] = r.backup; actions.push(...(r.adminActions || [])); }
      catch (e) { res.failed.push({ id: t.id, error: e.message }); }
    }
    const adminCats = clean.filter((id) => (junk.CATS.find((c) => c.id === id) || {}).admin);
    for (const id of adminCats) { const c = junk.CATS.find((x) => x.id === id); actions.push({ type: "del", dirs: junk.dirsOf(c), minAgeMs: c.minAge || 0, skipRecentDirs: !!c.skipRecentDirs, id }); }
    const needAdmin = actions.length > 0 || (restorePoint && userT.length > 0);
    if (needAdmin) {
      if (restorePoint) actions.unshift({ type: "restorepoint", description: "Piphin Turbo (antes das otimizações)" });
      const ar = await admin.runElevated(actions);
      if (ar.declined) {
        res.declined = true;
        for (const t of adminT) res.failed.push({ id: t.id, error: "permissão de administrador recusada" });
        for (const id of adminCats) res.failed.push({ id, error: "permissão de administrador recusada" });
      } else {
        for (const a of ar.actions || []) if (a.type === "del") { res.bytes += a.bytes || 0; res.files += a.files || 0; }
        const rp = (ar.actions || []).find((a) => a.type === "restorepoint");
        if (rp) res.restorePoint = rp.ok ? "criado" : rp.error;
        for (const t of adminT) if (pendingBackups[t.id]) { if (!backups[t.id]) backups[t.id] = pendingBackups[t.id]; res.done.push(t.id); if (t.reboot) res.reboot = true; }
      }
    }
    // parte de usuário comum
    const userCats = clean.filter((id) => !adminCats.includes(id));
    if (userCats.length) { const r = await junk.clean(userCats); res.bytes += r.bytes; res.files += r.files; res.skipped += r.skipped; }
    for (const t of userT) {
      try { const r = await tweaks.apply(t.id); if (!backups[t.id]) backups[t.id] = r.backup; res.done.push(t.id); if (t.reboot) res.reboot = true; }
      catch (e) { res.failed.push({ id: t.id, error: e.message }); }
    }
    writeJson(BACKUP, backups);
    if (clean.length) log("limpeza", `Limpeza: ${fmtBytes(res.bytes)} liberados`, { bytes: res.bytes, files: res.files, cats: clean });
    if (res.done.length) log("otimização", `Otimizações aplicadas: ${res.done.map((id) => tweaks.TWEAKS.find((t) => t.id === id).name).join(", ")}`, { ids: res.done });
    if (res.restorePoint === "criado") log("restauração", "Ponto de restauração criado antes das mudanças");
    lastJunk = null;
    res.state = await tweaks.state();
    return res;
  }
  const cleanJunk = (ids) => optimize({ clean: ids });
  const applyTweaks = (ids, { restorePoint = true } = {}) => optimize({ tweakIds: ids, restorePoint });
  async function revertTweaks(ids) {
    ids = ids && ids.length ? ids : Object.keys(backups);
    const adminActions = [], done = [];
    for (const id of ids) {
      if (!backups[id]) continue;
      const r = await tweaks.revert(backups[id]);
      adminActions.push(...r.adminActions);
      if (id === "mouse") { const v = await sys.regGet("HKCU\\Control Panel\\Mouse", "MouseSpeed"); await tweaksMouse(v && v.value !== "0"); }
      done.push(id);
    }
    let declined = false;
    if (adminActions.length) { const ar = await admin.runElevated(adminActions); declined = !!ar.declined; }
    for (const id of done) if (!(declined && (tweaks.TWEAKS.find((t) => t.id === id) || {}).admin)) delete backups[id];
    writeJson(BACKUP, backups);
    if (done.length) log("desfazer", `Desfeito: ${done.map((id) => (tweaks.TWEAKS.find((t) => t.id === id) || { name: id }).name).join(", ")}`, { ids: done });
    return { done, declined, state: await tweaks.state() };
  }
  const tweaksMouse = (accel) => sys.psRun(`Add-Type -Name M -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SystemParametersInfo(int a, int b, int[] c, int d);'; [W.M]::SystemParametersInfo(4, 0, [int[]](${accel ? "6,10,1" : "0,0,0"}), 3) | Out-Null`, 20000);

  // ---------------------------------------------------------------- modo turbo (na hora de jogar)
  let turbo = readJson(path.join(ctx.dataDir, "turbo.json"), null);
  async function turboOn(apps = []) {
    const cur = await tweaks.activeScheme();
    let target = (await tweaks.schemes()).find((s) => s.guid === tweaks.HIGH) || (await tweaks.schemes()).find(tweaks.isPerfScheme);
    if (!target) { const r = await sys.run(sys.exe("powercfg.exe"), ["-duplicatescheme", tweaks.HIGH]); const m = /([0-9a-f]{8}-[0-9a-f-]{27})/i.exec(r.out); if (m) target = { guid: m[1].toLowerCase() }; }
    if (target) await sys.run(sys.exe("powercfg.exe"), ["/setactive", target.guid]);
    const closed = [];
    for (const a of apps) { try { if (await startup.closeApp(a)) closed.push(a); } catch { /* protegido */ } }
    await sys.run(sys.exe("ipconfig.exe"), ["/flushdns"]);
    turbo = { on: true, since: Date.now(), prevScheme: turbo && turbo.on ? turbo.prevScheme : cur && cur.guid, closed };
    writeJson(path.join(ctx.dataDir, "turbo.json"), turbo);
    log("turbo", `Modo Turbo ligado${closed.length ? ` (fechados: ${closed.join(", ")})` : ""}`);
    return turbo;
  }
  async function turboOff() {
    if (turbo && turbo.prevScheme && !backups.power) await sys.run(sys.exe("powercfg.exe"), ["/setactive", turbo.prevScheme]);
    turbo = { on: false };
    writeJson(path.join(ctx.dataDir, "turbo.json"), turbo);
    log("turbo", "Modo Turbo desligado (plano de energia de volta ao anterior)");
    return turbo;
  }

  // ---------------------------------------------------------------- chamadas da tela
  ctx.handle("info", () => ({ tweaks: tweaks.TWEAKS, cats: junk.CATS.map(({ id, name, icon, desc, admin: a, def }) => ({ id, name, icon, desc, admin: a, def })), backups: Object.keys(backups), turbo, history, prefs: readJson(PREFS, {}) }));
  ctx.handle("checkup", () => exclusive("check-up", () => checkup((t) => ctx.emit("progress", t))));
  ctx.handle("junk-scan", () => exclusive("análise", async () => (lastJunk = await junk.scan((id) => ctx.emit("progress", "Analisando: " + (junk.CATS.find((c) => c.id === id) || {}).name)))));
  ctx.handle("junk-clean", (ids) => exclusive("limpeza", () => cleanJunk(ids)));
  ctx.handle("optimize-all", (opts) => exclusive("otimização", () => optimize(opts)));
  ctx.handle("tweaks-state", () => tweaks.state());
  ctx.handle("tweaks-apply", (ids, opts) => exclusive("otimização", () => applyTweaks(ids, opts)));
  ctx.handle("tweaks-revert", (ids) => exclusive("desfazer", () => revertTweaks(ids)));
  ctx.handle("startup-list", () => startup.list());
  ctx.handle("startup-set", async (id, enabled) => {
    const r = await startup.setEnabled(id, enabled);
    if (r.adminActions.length) { const ar = await admin.runElevated(r.adminActions); if (ar.declined) throw new Error("Precisa da permissão de administrador para mudar este item"); }
    log("inicialização", `${enabled ? "Ligado" : "Desligado"} na inicialização: ${id.split("|")[2]}`);
    return startup.list();
  });
  ctx.handle("procs", () => startup.processes());
  ctx.handle("close-app", async (name, force) => { const ok = await startup.closeApp(name, force); if (ok) log("fechar", `Fechado: ${name}`); return ok; });
  ctx.handle("turbo-on", (apps) => exclusive("Modo Turbo", () => turboOn(apps || [])));
  ctx.handle("turbo-off", () => exclusive("Modo Turbo", () => turboOff()));
  ctx.handle("restore-point", () => exclusive("ponto de restauração", async () => {
    const ar = await admin.runElevated([{ type: "restorepoint", description: "Piphin Turbo (manual)" }]);
    if (ar.declined) throw new Error("Permissão de administrador recusada");
    const rp = (ar.actions || [])[0];
    if (!rp || !rp.ok) throw new Error("Não deu para criar: " + ((rp && rp.error) || "erro desconhecido"));
    log("restauração", "Ponto de restauração criado");
    return true;
  }));
  ctx.handle("open-restore", () => sys.run(sys.exe("rstrui.exe"), []).then(() => true));
  ctx.handle("prefs", (patch) => { let p = readJson(PREFS, {}); if (patch) { p = { ...p, ...patch }; writeJson(PREFS, p); } return p; });

  // ---------------------------------------------------------------- ferramentas para a IA (sempre com confirmação)
  const ask = async (message, detail, yes) => (await ctx.host.messageBox({ type: "question", title: "Piphin Turbo", message, detail, buttons: [yes, "Cancelar"], defaultId: 0, cancelId: 1 })) === 0;
  ctx.handle("tool:pc_checkup", async () => {
    const c = await exclusive("check-up", () => checkup());
    ctx.emit("checkup", c);
    return { health_score: c.score, problems: c.findings.map((f) => ({ level: f.level, problem: f.title, details: f.text })),
      junk: c.junk.map((j) => ({ category: j.id, name: j.name, size: fmtBytes(j.bytes), needs_admin: j.admin, selected_by_default: j.def })),
      game_settings: tweaks.TWEAKS.map((t) => ({ id: t.id, name: t.name, active: !!(c.tweaks[t.id] || {}).on, recommended: t.recommended, impact: t.impact })),
      startup_programs: c.startup, disk_free: c.disk && fmtBytes(c.disk.free), ram_in_use: Math.round((c.ram.used / c.ram.total) * 100) + "%" };
  });
  ctx.handle("tool:clean_junk", async (a = {}) => {
    const ids = (a.categories && a.categories.length ? a.categories : junk.CATS.filter((c) => c.def).map((c) => c.id)).filter((id) => junk.CATS.some((c) => c.id === id));
    const scan = lastJunk || (await junk.scan());
    const total = scan.filter((c) => ids.includes(c.id)).reduce((n, c) => n + c.bytes, 0);
    const names = ids.map((id) => junk.CATS.find((c) => c.id === id).name).join(", ");
    if (!(await ask(`A IA quer limpar ${fmtBytes(total)} de lixo`, `Categorias: ${names}.\n\nDocumentos, fotos, downloads, senhas e histórico não são tocados.`, "Limpar"))) throw new Error("A pessoa não autorizou a limpeza");
    const r = await exclusive("limpeza", () => cleanJunk(ids));
    ctx.emit("refresh");
    return { freed: fmtBytes(r.bytes), files: r.files, admin_declined: r.declined };
  });
  ctx.handle("tool:optimize_for_games", async (a = {}) => {
    const ids = (a.tweaks && a.tweaks.length ? a.tweaks : tweaks.TWEAKS.filter((t) => t.recommended).map((t) => t.id)).filter((id) => tweaks.TWEAKS.some((t) => t.id === id));
    const st = await tweaks.state(), todo = ids.filter((id) => !(st[id] || {}).on);
    if (!todo.length) return { ok: true, note: "Tudo já estava otimizado" };
    const names = todo.map((id) => "• " + tweaks.TWEAKS.find((t) => t.id === id).name).join("\n");
    if (!(await ask("A IA quer otimizar o PC para jogos", `${names}\n\nTudo pode ser desfeito depois no Piphin Turbo. Um ponto de restauração do Windows será criado antes.`, "Otimizar"))) throw new Error("A pessoa não autorizou as otimizações");
    const r = await exclusive("otimização", () => applyTweaks(todo, { restorePoint: true }));
    ctx.emit("refresh");
    return { applied: r.done, failed: r.failed, needs_reboot: r.reboot };
  });
  ctx.handle("tool:undo_optimizations", async () => {
    if (!Object.keys(backups).length) return { note: "Nada para desfazer" };
    if (!(await ask("A IA quer desfazer as otimizações do Piphin Turbo", "Os ajustes voltam a ser como eram antes.", "Desfazer"))) throw new Error("A pessoa não autorizou");
    const r = await exclusive("desfazer", () => revertTweaks());
    ctx.emit("refresh");
    return { reverted: r.done };
  });
  ctx.handle("tool:list_startup", async () => (await startup.list()).map((s) => ({ name: s.nice, entry: s.name, enabled: s.enabled, suggestion: s.keep === false ? "pode desligar" : s.keep ? "deixe ligado" : "", tip: s.tip })));
  ctx.handle("tool:set_startup", async (a = {}) => {
    const list = await startup.list(), q = String(a.name || "").toLowerCase();
    const it = list.find((s) => s.name.toLowerCase() === q || s.nice.toLowerCase() === q) || list.find((s) => s.name.toLowerCase().includes(q) || s.nice.toLowerCase().includes(q));
    if (!it) throw new Error("Programa não encontrado na inicialização: " + a.name);
    if (!(await ask(`A IA quer ${a.enabled ? "ligar" : "desligar"} "${it.nice}" na inicialização do Windows`, it.tip || "Dá para mudar de volta a qualquer momento.", a.enabled ? "Ligar" : "Desligar"))) throw new Error("A pessoa não autorizou");
    const r = await startup.setEnabled(it.id, !!a.enabled);
    if (r.adminActions.length) { const ar = await admin.runElevated(r.adminActions); if (ar.declined) throw new Error("Permissão de administrador recusada"); }
    log("inicialização", `${a.enabled ? "Ligado" : "Desligado"} pela IA: ${it.nice}`);
    ctx.emit("refresh");
    return { ok: true, program: it.nice, enabled: !!a.enabled };
  });
  ctx.handle("tool:turbo_mode", async (a = {}) => {
    if (a.on === false) return { turbo: await exclusive("Modo Turbo", () => turboOff()) };
    const apps = Array.isArray(a.close_apps) ? a.close_apps : [];
    if (!(await ask("A IA quer ligar o Modo Turbo", `Plano de energia de alto desempenho${apps.length ? ` e fechar: ${apps.join(", ")}` : ""}. Trabalho não salvo nesses programas pode ser perdido.`, "Ligar"))) throw new Error("A pessoa não autorizou");
    const t = await exclusive("Modo Turbo", () => turboOn(apps));
    ctx.emit("refresh");
    return { turbo: t };
  });
};
