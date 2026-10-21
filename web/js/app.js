// Piphin Turbo · tela. Linguagem simples, um botão grande para cada coisa e confirmação antes de mudar algo.
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const call = async (ch, ...a) => { const r = await piphin.invoke(ch, ...a); if (!r.ok) throw new Error(r.error); return r.data; };
const gb = (b) => (b >= 1e9 ? (b / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " GB" : b >= 1e6 ? Math.round(b / 1e6) + " MB" : b > 0 ? Math.round(b / 1e3) + " KB" : "0");

const S = { tab: "home", info: null, check: null, junk: null, tstate: null, startup: null, procs: null, showBg: false, lastClean: null, turboApps: [] };

// ---------------------------------------------------------------- avisos e diálogos
function toast(text, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind; el.textContent = text;
  $("#toasts").appendChild(el); setTimeout(() => el.remove(), 4000);
}
const modal = $("#modal"), box = $("#modalBox");
const openModal = (html, cls = "") => { box.className = "modal-box " + cls; box.innerHTML = html; modal.hidden = false; };
const closeModal = () => { modal.hidden = true; box.innerHTML = ""; };
modal.addEventListener("mousedown", (e) => { if (e.target === modal) closeModal(); });
const confirmBox = (title, text, yes = "Continuar", danger = false) => new Promise((resolve) => {
  openModal(`<h3>${esc(title)}</h3><p>${text}</p><div class="modal-actions"><button class="btn" data-n>Cancelar</button><button class="btn ${danger ? "danger solid" : "primary"}" data-y>${esc(yes)}</button></div>`);
  box.querySelector("[data-y]").onclick = () => { closeModal(); resolve(true); };
  box.querySelector("[data-n]").onclick = () => { closeModal(); resolve(false); };
});
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, "err"); } };
piphin.on("busy", (what) => { $("#busy").hidden = !what; $("#busyTitle").textContent = what ? `${what[0].toUpperCase() + what.slice(1)}...` : ""; $("#busyText").textContent = what === "otimização" || what === "limpeza" ? "Se o Windows pedir permissão de administrador, clique em Sim." : ""; });
piphin.on("progress", (t) => { $("#busyText").textContent = t; });
piphin.on("history", (h) => { if (S.info) S.info.history = h; if (S.tab === "history") render(); });
piphin.on("refresh", () => { S.check = null; load(); });
piphin.on("checkup", (c) => { S.check = c; S.junk = c.junk; S.tstate = c.tweaks; if (S.tab === "home") render(); });

// ---------------------------------------------------------------- abas
$$(".p-subnav [data-tab]").forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; $$(".p-subnav [data-tab]").forEach((x) => x.classList.toggle("active", x === b)); render(); loadTab(); }));
async function loadTab() {
  try {
    if (S.tab === "home" && !S.check) await checkup();
    if (S.tab === "clean" && !S.junk) { S.junk = await call("junk-scan"); render(); }
    if (S.tab === "games") { S.tstate = await call("tweaks-state"); render(); }
    if (S.tab === "startup") { S.startup = await call("startup-list"); render(); }
    if (S.tab === "procs") { S.procs = await call("procs"); render(); }
  } catch (e) { toast(e.message, "err"); }
}
async function checkup() { S.check = await call("checkup"); S.junk = S.check.junk; S.tstate = S.check.tweaks; render(); }
async function load() { S.info = await call("info"); render(); loadTab(); }
function render() {
  $("#turboPill").hidden = !(S.info && S.info.turbo && S.info.turbo.on);
  const v = { home, clean, games, startup, procs, history }[S.tab];
  $("#content").innerHTML = `<div class="wrap">${v ? v() : ""}</div>`;
}
const loading = (t) => `<div class="card row"><span class="spin"></span><span class="muted">${esc(t)}</span></div>`;

// ---------------------------------------------------------------- início
function verdict(s) {
  if (s >= 85) return ["Seu PC está ótimo", "Está tudo em ordem para jogar. Dá para dar um toque final com os ajustes abaixo.", "#22c55e"];
  if (s >= 65) return ["Seu PC está bem", "Algumas coisas simples podem deixar o PC mais rápido e liberar espaço.", "#3b82f6"];
  if (s >= 45) return ["Dá para melhorar bastante", "Encontramos lixo e ajustes de jogo desligados. Um clique resolve quase tudo.", "#fb923c"];
  return ["Seu PC precisa de uma faxina", "Muito lixo e ajustes importantes desligados. Clique em Otimizar tudo.", "#f87171"];
}
function home() {
  const c = S.check;
  if (!c) return loading("Analisando seu PC (nada é mudado nesta etapa)...");
  const [title, text, color] = verdict(c.score), R = 96, L = 2 * Math.PI * R;
  const tw = S.info.tweaks, active = tw.filter((t) => (c.tweaks[t.id] || {}).on).length;
  const junkDef = c.junk.filter((j) => j.def).reduce((n, j) => n + j.bytes, 0);
  const t = S.info.turbo || {};
  return `<section class="hero">
      <div class="ring" style="--ring-c:${color}88"><svg viewBox="0 0 220 220"><circle cx="110" cy="110" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="16"/>
        <circle cx="110" cy="110" r="${R}" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${L}" stroke-dashoffset="${L * (1 - c.score / 100)}"/></svg>
        <div class="val"><b>${c.score}</b><span>saúde do PC</span></div></div>
      <div><h2>${title}</h2><p>${text}</p>
        <div class="acts"><button class="btn blue big" data-act="optimize"><i class="i i-rocket"></i>Otimizar tudo</button><button class="btn big" data-act="recheck"><i class="i i-refresh-cw"></i>Analisar de novo</button></div>
        <p class="faint" style="margin:12px 0 0">Tudo o que for mudado pode ser desfeito na aba Jogos ou no Histórico.</p></div></section>
    <div class="stats">
      <div class="stat"><i class="i i-brush"></i><b>${gb(junkDef)}</b><span>de lixo para limpar</span></div>
      <div class="stat"><i class="i i-gamepad-2"></i><b>${active} de ${tw.length}</b><span>ajustes de jogo ativos</span></div>
      <div class="stat"><i class="i i-power"></i><b>${c.startup.enabled}</b><span>programas abrem com o Windows</span></div>
      <div class="stat"><i class="i i-hard-drive"></i><b>${c.disk ? gb(c.disk.free) : "?"}</b><span>livres no disco do Windows</span></div></div>
    <div class="turbo-card"><div><h3><i class="i i-rocket"></i>${t.on ? "Modo Turbo ligado" : "Vai jogar agora?"}</h3>
      <p>${t.on ? "O PC está no máximo desempenho. Quando terminar de jogar, desligue para voltar ao normal." : "O Modo Turbo coloca o PC no máximo desempenho e fecha os programas que você escolher. Desliga com um clique."}</p></div>
      ${t.on ? `<button class="btn big" data-act="turbo-off"><i class="i i-power-off"></i>Desligar</button>` : `<button class="btn blue big" data-act="turbo-on"><i class="i i-zap"></i>Ligar Modo Turbo</button>`}</div>
    <div><h3 style="margin:6px 0 10px;font-size:15px">O que encontramos</h3>
      ${c.findings.length ? `<div class="finds">${c.findings.map((f) => `<div class="find"><span class="ic ${f.level}"><i class="i i-${f.level === "alto" ? "triangle-alert" : f.level === "médio" ? "circle-alert" : "info"}"></i></span>
        <div class="grow"><h4>${esc(f.title)}</h4><p>${esc(f.text)}</p></div>
        <button class="btn" data-act="${f.action}">${{ clean: "Limpar", optimize: "Resolver", startup: "Ver", procs: "Ver" }[f.action] || "Ver"}<i class="i i-chevron-right"></i></button></div>`).join("")}</div>`
        : `<div class="allgood"><i class="i i-circle-check"></i><div><b>Nenhum problema encontrado.</b><div class="faint">Seu PC está pronto para jogar.</div></div></div>`}</div>`;
}

// diálogo "Otimizar tudo": mostra exatamente o que vai acontecer
function optimizeDialog() {
  const c = S.check, tw = S.info.tweaks;
  const cats = (S.junk || c.junk).filter((j) => j.def && j.bytes > 0);
  const todo = tw.filter((t) => t.recommended && !((S.tstate || c.tweaks)[t.id] || {}).on);
  if (!cats.length && !todo.length) return toast("Já está tudo otimizado!", "ok");
  openModal(`<h3>Otimizar tudo</h3><p>Confira o que vai ser feito. Desmarque o que não quiser.</p>
    <div class="checks">${cats.map((j) => `<label><input type="checkbox" data-c="${j.id}" checked><i class="i i-${j.icon}"></i>Limpar: ${esc(j.name)}<small>${gb(j.bytes)}</small></label>`).join("")}
      ${todo.map((t) => `<label><input type="checkbox" data-t="${t.id}" checked><i class="i i-${t.icon}"></i>${esc(t.name)}${t.reboot ? `<small>precisa reiniciar</small>` : t.admin ? `<small>administrador</small>` : ""}</label>`).join("")}</div>
    <label class="checks" style="margin-top:10px"><label><input type="checkbox" id="oRp" checked><i class="i i-life-buoy"></i>Criar um ponto de restauração do Windows antes (recomendado)</label></label>
    <p class="faint" style="margin-top:10px">Documentos, fotos, downloads, senhas e histórico não são tocados. O Windows vai pedir permissão de administrador uma vez.</p>
    <div class="modal-actions"><button class="btn" data-n>Cancelar</button><button class="btn blue" data-y><i class="i i-rocket"></i>Otimizar</button></div>`, "wide");
  box.querySelector("[data-n]").onclick = closeModal;
  box.querySelector("[data-y]").onclick = guard(async () => {
    const clean = $$("[data-c]:checked", box).map((x) => x.dataset.c), tweakIds = $$("[data-t]:checked", box).map((x) => x.dataset.t), restorePoint = $("#oRp").checked;
    closeModal();
    const r = await call("optimize-all", { clean, tweakIds, restorePoint });
    showResult(r);
    S.check = null; S.junk = null; S.info = await call("info"); render(); loadTab();
  });
}
function showResult(r) {
  const names = (ids) => ids.map((id) => (S.info.tweaks.find((t) => t.id === id) || S.info.cats.find((c) => c.id === id) || { name: id }).name);
  openModal(`<h3>${r.declined ? "Feito em parte" : "Pronto!"}</h3>
    ${r.bytes ? `<div class="result" style="margin-top:10px"><i class="i i-sparkles"></i><div><b>${gb(r.bytes)}</b><div class="faint">liberados (${r.files.toLocaleString("pt-BR")} arquivos)</div></div></div>` : ""}
    ${r.done && r.done.length ? `<p style="margin-top:12px"><b>Ativado:</b> ${esc(names(r.done).join(", "))}</p>` : ""}
    ${r.restorePoint === "criado" ? `<p class="faint">Ponto de restauração do Windows criado.</p>` : r.restorePoint ? `<div class="warnbox"><i class="i i-triangle-alert"></i>Não deu para criar o ponto de restauração (${esc(r.restorePoint)}). As mudanças ainda podem ser desfeitas pelo Piphin Turbo.</div>` : ""}
    ${r.declined ? `<div class="warnbox" style="margin-top:8px"><i class="i i-triangle-alert"></i>A permissão de administrador foi recusada: a limpeza do Windows e os ajustes avançados ficaram de fora.</div>` : ""}
    ${r.reboot ? `<div class="warnbox" style="margin-top:8px"><i class="i i-rotate-ccw"></i>Reinicie o PC para o agendamento de GPU começar a valer.</div>` : ""}
    <div class="modal-actions"><button class="btn primary" data-n>Fechar</button></div>`);
  box.querySelector("[data-n]").onclick = closeModal;
}
async function turboDialog() {
  const list = (await call("procs")).filter((p) => p.window && p.mem > 80e6).slice(0, 10);
  const pref = new Set((S.info.prefs.turboApps || []).map((x) => x.toLowerCase()));
  openModal(`<h3>Ligar o Modo Turbo</h3><p>O plano de energia vai para alto desempenho. Escolha se quer fechar algum programa pesado antes de jogar (salve o que estiver fazendo neles).</p>
    <div class="checks">${list.map((p) => `<label><input type="checkbox" data-app="${esc(p.name)}" ${pref.has(p.name.toLowerCase()) ? "checked" : ""}>${esc(p.desc || p.name)}<small>${gb(p.mem)}</small></label>`).join("") || `<p class="faint">Nenhum programa pesado aberto.</p>`}</div>
    <div class="modal-actions"><button class="btn" data-n>Cancelar</button><button class="btn blue" data-y><i class="i i-zap"></i>Ligar</button></div>`, "wide");
  box.querySelector("[data-n]").onclick = closeModal;
  box.querySelector("[data-y]").onclick = guard(async () => {
    const apps = $$("[data-app]:checked", box).map((x) => x.dataset.app);
    closeModal();
    await call("prefs", { turboApps: apps });
    await call("turbo-on", apps);
    S.info = await call("info"); render();
    toast("Modo Turbo ligado. Bom jogo!", "ok");
  });
}

// ---------------------------------------------------------------- limpeza
function clean() {
  if (!S.junk) return loading("Procurando lixo (nada é apagado ainda)...");
  const sel = S.cleanSel || new Set(S.junk.filter((j) => j.def).map((j) => j.id));
  S.cleanSel = sel;
  const total = S.junk.filter((j) => sel.has(j.id)).reduce((n, j) => n + j.bytes, 0);
  return `<div><h1 class="t">Limpeza</h1><p class="sub">Apaga arquivos que só ocupam espaço. Documentos, fotos, downloads, senhas e histórico ficam intactos.</p></div>
    ${S.lastClean ? `<div class="result"><i class="i i-circle-check"></i><div><b>${gb(S.lastClean.bytes)} liberados</b><div class="faint">${S.lastClean.files.toLocaleString("pt-BR")} arquivos apagados${S.lastClean.skipped ? ` · ${S.lastClean.skipped.toLocaleString("pt-BR")} em uso ficaram` : ""}${S.lastClean.declined ? " · a parte do Windows precisava de permissão de administrador" : ""}</div></div></div>` : ""}
    <div class="list">${S.junk.map((j) => `<label class="item ${sel.has(j.id) ? "on" : ""}"><input type="checkbox" data-cat="${j.id}" ${sel.has(j.id) ? "checked" : ""}>
      <div><h4><i class="i i-${j.icon}"></i>${esc(j.name)} ${j.def ? `<span class="badge rec">Recomendado</span>` : `<span class="badge">Opcional</span>`} ${j.admin ? `<span class="badge adm">Administrador</span>` : ""}</h4><p>${esc(j.desc)}</p></div>
      <div class="size">${gb(j.bytes)}<small>${j.files.toLocaleString("pt-BR")} arquivos</small></div></label>`).join("")}</div>
    <div class="bar"><div class="grow"><span class="faint">Selecionado</span><br><b>${gb(total)}</b></div><button class="btn" data-act="rescan"><i class="i i-refresh-cw"></i>Analisar de novo</button>
      <button class="btn blue big" data-act="do-clean" ${total ? "" : "disabled"}><i class="i i-brush"></i>Limpar agora</button></div>`;
}

// ---------------------------------------------------------------- jogos
function games() {
  const st = S.tstate, tw = S.info.tweaks, backups = new Set(S.info.backups);
  if (!st) return loading("Verificando as configurações...");
  const todo = tw.filter((t) => t.recommended && !(st[t.id] || {}).on);
  return `<div class="row"><div class="grow"><h1 class="t">Otimizações para jogos</h1><p class="sub">Ajustes do próprio Windows, explicados. Cada um pode ser desfeito.</p></div>
      <button class="btn blue big" data-act="tw-rec" ${todo.length ? "" : "disabled"}><i class="i i-rocket"></i>${todo.length ? `Ativar os ${todo.length} recomendados` : "Recomendados ativos"}</button></div>
    <div class="list">${tw.map((t) => { const on = (st[t.id] || {}).on, mine = backups.has(t.id);
      return `<div class="item ${on ? "on" : ""}"><span class="ic"><i class="i i-${t.icon}"></i></span>
        <div><h4>${esc(t.name)} ${t.recommended ? `<span class="badge rec">Recomendado</span>` : `<span class="badge">Opcional</span>`}
          <span class="badge ${t.impact === "alto" ? "hi" : t.impact === "médio" ? "md" : "lo"}">Impacto ${t.impact}</span>${t.admin ? `<span class="badge adm">Administrador</span>` : ""}${t.reboot ? `<span class="badge boot">Reiniciar</span>` : ""}</h4>
          <p>${esc(t.desc)}${t.id === "power" && st.power ? ` <span class="faint">(agora: ${esc(st.power.detail)})</span>` : ""}</p></div>
        <div class="row" style="gap:8px"><span class="state ${on ? "yes" : "no"}">${on ? "Ativo" : "Desligado"}</span>
          ${mine ? `<button class="btn sm" data-undo="${t.id}"><i class="i i-undo-2"></i>Desfazer</button>` : on ? "" : `<button class="btn sm primary" data-apply="${t.id}">Ativar</button>`}</div></div>`; }).join("")}</div>
    <div class="card row"><i class="i i-life-buoy" style="font-size:22px;color:var(--tb)"></i><div class="grow"><b>Segurança</b><div class="faint">Antes de mudanças grandes, crie um ponto de restauração do Windows. Se algo der errado, dá para voltar o PC inteiro.</div></div>
      <button class="btn" data-act="rp"><i class="i i-shield-check"></i>Criar ponto de restauração</button><button class="btn" data-act="rp-open">Restaurar o sistema...</button>
      ${backups.size ? `<button class="btn danger" data-act="undo-all"><i class="i i-undo-2"></i>Desfazer tudo</button>` : ""}</div>`;
}

// ---------------------------------------------------------------- inicialização
function startup() {
  if (!S.startup) return loading("Lendo os programas da inicialização...");
  const list = [...S.startup].sort((a, b) => (b.enabled - a.enabled) || ((a.keep === false) - (b.keep === false)) * -1);
  const on = list.filter((s) => s.enabled).length;
  return `<div><h1 class="t">Inicialização</h1><p class="sub">${on} de ${list.length} programas abrem sozinhos quando o Windows liga. Cada um deixa o PC ligar mais devagar e ocupa memória. Desligar aqui não desinstala nada: dá para abrir o programa quando quiser.</p></div>
    <div class="list">${list.map((s) => `<div class="item ${s.enabled ? "on" : ""}"><span class="ic"><i class="i i-${s.enabled ? "power" : "power-off"}"></i></span>
      <div><h4>${esc(s.nice)} ${s.keep === false ? `<span class="badge md">Pode desligar</span>` : s.keep ? `<span class="badge rec">Deixe ligado</span>` : ""}${s.admin ? `<span class="badge adm">Administrador</span>` : ""}</h4>
        <p>${esc(s.tip || "Programa instalado no PC.")} <span class="faint">${esc(s.exe || s.cmd)}</span></p></div>
      <button class="btn sm ${s.enabled ? "" : "primary"}" data-su="${esc(s.id)}" data-on="${s.enabled ? 0 : 1}">${s.enabled ? "Desligar" : "Ligar"}</button></div>`).join("")}</div>`;
}

// ---------------------------------------------------------------- programas abertos
function procs() {
  if (!S.procs) return loading("Vendo os programas abertos...");
  const list = S.procs.filter((p) => S.showBg || p.window), max = Math.max(...S.procs.map((p) => p.mem), 1);
  const total = S.procs.reduce((n, p) => n + p.mem, 0);
  return `<div class="row"><div class="grow"><h1 class="t">Programas abertos</h1><p class="sub">Os programas abertos agora, do que usa mais memória para o que usa menos (${gb(total)} no total). Feche os que não está usando antes de jogar.</p></div>
      <label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="pBg" ${S.showBg ? "checked" : ""}>Mostrar os de segundo plano</label><button class="btn" data-act="procs-refresh"><i class="i i-refresh-cw"></i>Atualizar</button></div>
    <div class="list">${list.map((p) => `<div class="item"><span class="ic"><i class="i i-${p.window ? "app-window" : "layers"}"></i></span>
      <div><h4>${esc(p.desc || p.name)} ${p.count > 1 ? `<span class="badge">${p.count} processos</span>` : ""}</h4><p class="faint">${esc(p.title || p.name + ".exe")}</p><div class="mem"><i style="width:${(p.mem / max) * 100}%"></i></div></div>
      <div class="row" style="gap:10px"><div class="size">${gb(p.mem)}<small>memória</small></div><button class="btn sm" data-close="${esc(p.name)}" data-desc="${esc(p.desc || p.name)}"><i class="i i-x"></i>Fechar</button></div></div>`).join("") || `<p class="faint">Nada para mostrar.</p>`}</div>`;
}

// ---------------------------------------------------------------- histórico
function history() {
  const h = (S.info && S.info.history) || [];
  return `<div><h1 class="t">Histórico</h1><p class="sub">Tudo o que o Piphin Turbo fez neste PC. As otimizações podem ser desfeitas na aba Jogos.</p></div>
    <div class="card" style="padding:4px 0">${h.map((e) => `<div class="hist"><span>${new Date(e.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span><div>${esc(e.text)}</div></div>`).join("") || `<p class="faint" style="padding:14px">Nada feito ainda.</p>`}</div>`;
}

// ---------------------------------------------------------------- cliques
document.addEventListener("click", guard(async (e) => {
  const act = e.target.closest("[data-act]");
  if (act) {
    const a = act.dataset.act;
    if (a === "optimize") return optimizeDialog();
    if (a === "recheck") { S.check = null; render(); return checkup(); }
    if (a === "clean") { $$(".p-subnav [data-tab]").find((b) => b.dataset.tab === "clean").click(); return; }
    if (a === "startup") { $$(".p-subnav [data-tab]").find((b) => b.dataset.tab === "startup").click(); return; }
    if (a === "procs") { $$(".p-subnav [data-tab]").find((b) => b.dataset.tab === "procs").click(); return; }
    if (a === "turbo-on") return turboDialog();
    if (a === "turbo-off") { await call("turbo-off"); S.info = await call("info"); render(); return toast("Modo Turbo desligado", "ok"); }
    if (a === "rescan") { S.junk = null; S.lastClean = null; render(); S.junk = await call("junk-scan"); return render(); }
    if (a === "do-clean") {
      const ids = [...S.cleanSel], total = S.junk.filter((j) => S.cleanSel.has(j.id)).reduce((n, j) => n + j.bytes, 0);
      const recycle = ids.includes("recycle");
      if (!(await confirmBox("Limpar agora?", `Vão ser apagados cerca de <b>${gb(total)}</b> de lixo.${recycle ? "<br><br><b>A Lixeira será esvaziada</b>: o que está nela some de vez." : ""}${ids.some((id) => (S.info.cats.find((c) => c.id === id) || {}).admin) ? "<br><br>O Windows vai pedir permissão de administrador para a parte do sistema." : ""}`, "Limpar", recycle))) return;
      S.lastClean = await call("junk-clean", ids);
      S.junk = await call("junk-scan"); S.check = null;
      return render();
    }
    if (a === "tw-rec") { const ids = S.info.tweaks.filter((t) => t.recommended && !(S.tstate[t.id] || {}).on).map((t) => t.id); return applyTweaks(ids); }
    if (a === "undo-all") { if (!(await confirmBox("Desfazer tudo?", "Todas as otimizações feitas pelo Piphin Turbo voltam a ser como eram antes.", "Desfazer tudo"))) return; await call("tweaks-revert", []); return afterTweaks("Tudo desfeito"); }
    if (a === "rp") { await call("restore-point"); return toast("Ponto de restauração criado", "ok"); }
    if (a === "rp-open") return call("open-restore");
    if (a === "procs-refresh") { S.procs = await call("procs"); return render(); }
  }
  const ap = e.target.closest("[data-apply]");
  if (ap) return applyTweaks([ap.dataset.apply]);
  const un = e.target.closest("[data-undo]");
  if (un) { await call("tweaks-revert", [un.dataset.undo]); return afterTweaks("Desfeito"); }
  const su = e.target.closest("[data-su]");
  if (su) { S.startup = await call("startup-set", su.dataset.su, su.dataset.on === "1"); S.check = null; render(); return toast(su.dataset.on === "1" ? "Vai abrir com o Windows" : "Não abre mais sozinho", "ok"); }
  const cl = e.target.closest("[data-close]");
  if (cl) {
    if (!(await confirmBox(`Fechar ${cl.dataset.desc}?`, "Salve o que estiver fazendo nele antes. O programa fecha como se você clicasse no X.", "Fechar"))) return;
    const ok = await call("close-app", cl.dataset.close, false);
    toast(ok ? "Fechado" : "O programa não quis fechar (pode estar pedindo para salvar algo)", ok ? "ok" : "warn");
    setTimeout(async () => { S.procs = await call("procs"); render(); }, 1200);
  }
}));
document.addEventListener("change", (e) => {
  if (e.target.dataset.cat) { e.target.checked ? S.cleanSel.add(e.target.dataset.cat) : S.cleanSel.delete(e.target.dataset.cat); render(); }
  if (e.target.id === "pBg") { S.showBg = e.target.checked; render(); }
});
async function applyTweaks(ids) {
  const list = ids.map((id) => S.info.tweaks.find((t) => t.id === id));
  const admin = list.some((t) => t.admin);
  if (!(await confirmBox(list.length > 1 ? `Ativar ${list.length} otimizações?` : `Ativar "${list[0].name}"?`, `${list.map((t) => "• " + esc(t.name)).join("<br>")}<br><br>${admin ? "Um ponto de restauração do Windows será criado antes e o Windows vai pedir permissão de administrador. " : ""}Dá para desfazer a qualquer momento.`, "Ativar"))) return;
  const r = await call("tweaks-apply", ids, { restorePoint: admin });
  showResult(r);
  S.info = await call("info"); S.tstate = r.state; S.check = null; render();
}
async function afterTweaks(msg) { S.info = await call("info"); S.tstate = await call("tweaks-state"); S.check = null; render(); toast(msg, "ok"); }

window.addEventListener("beforeunload", () => {});
load().catch((e) => toast(e.message, "err"));
