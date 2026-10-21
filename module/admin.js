// Piphin Turbo · ajudante de administrador: junta tudo o que precisa de permissão (limpar pastas do Windows,
// ajustes em HKLM, ponto de restauração) e roda de uma vez, com UM pedido do Windows (UAC).
// O script vai embutido no comando (-EncodedCommand), sem arquivos .ps1 soltos.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const sys = require("./sys");

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$job = Get-Content -LiteralPath '__JOB__' -Raw -Encoding UTF8 | ConvertFrom-Json
$res = [ordered]@{ ok = $true; actions = @() }
foreach ($a in $job.actions) {
  $r = [ordered]@{ type = $a.type; ok = $true; bytes = 0; files = 0; error = '' }
  try {
    switch ($a.type) {
      'del' {
        $limit = (Get-Date).AddMilliseconds(-[double]$a.minAgeMs)
        foreach ($d in $a.dirs) {
          if (-not (Test-Path -LiteralPath $d)) { continue }
          # pastas de primeiro nível mexidas há pouco (programa aberto usando) ficam inteiras
          $skip = @(); if ($a.skipRecentDirs) { $dirLimit = (Get-Date).AddMilliseconds(-[math]::Max([double]$a.minAgeMs, 3600000)); $skip = @(Get-ChildItem -LiteralPath $d -Force -Directory -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $dirLimit } | ForEach-Object { $_.FullName + [IO.Path]::DirectorySeparatorChar }) }
          Get-ChildItem -LiteralPath $d -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $f = $_.FullName; $_.LastWriteTime -lt $limit -and -not ($skip | Where-Object { $f.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) }) } | ForEach-Object {
            $len = $_.Length
            try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop; $r.bytes += $len; $r.files++ } catch {}
          }
          # tira só as pastas que ficaram vazias (das mais fundas para cima); nada de apagar com o que tem dentro
          Get-ChildItem -LiteralPath $d -Recurse -Force -Directory -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object {
            if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) { [IO.Directory]::Delete($_.FullName) }
          }
        }
      }
      'reg' {
        $out = & reg.exe add $a.key /v $a.name /t $a.kind /d $a.value /f 2>&1
        if ($LASTEXITCODE -ne 0) { $r.ok = $false; $r.error = "$out" }
      }
      'regdel' { & reg.exe delete $a.key /v $a.name /f 2>&1 | Out-Null }
      'restorepoint' {
        Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue
        # o Windows só cria um ponto a cada 24 h por padrão: libera só para este pedido e volta como estava
        $srk = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore'
        $old = (Get-ItemProperty -Path $srk -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue).SystemRestorePointCreationFrequency
        Set-ItemProperty -Path $srk -Name SystemRestorePointCreationFrequency -Value 0 -Type DWord
        try { Checkpoint-Computer -Description $a.description -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop }
        finally { if ($null -eq $old) { Remove-ItemProperty -Path $srk -Name SystemRestorePointCreationFrequency -ErrorAction SilentlyContinue } else { Set-ItemProperty -Path $srk -Name SystemRestorePointCreationFrequency -Value $old -Type DWord } }
      }
    }
  } catch { $r.ok = $false; $r.error = $_.Exception.Message }
  $res.actions += $r
}
$res | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath '__OUT__' -Encoding UTF8
`;

// roda as ações como administrador; devolve { ok, actions } ou { declined: true }
async function runElevated(actions) {
  if (!actions.length) return { ok: true, actions: [] };
  const dir = path.join(os.tmpdir(), "piphin-turbo");
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomBytes(6).toString("hex");
  const job = path.join(dir, `job-${id}.json`), out = path.join(dir, `res-${id}.json`);
  fs.writeFileSync(job, JSON.stringify({ actions }), "utf8");
  const q = (s) => s.replace(/'/g, "''");
  const script = SCRIPT.replace("__JOB__", q(job)).replace("__OUT__", q(out));
  const enc = Buffer.from(script, "utf16le").toString("base64");
  const ps = sys.exe("WindowsPowerShell\\v1.0\\powershell.exe");
  // um PowerShell comum pede a elevação (Start-Process -Verb RunAs) e espera o elevado terminar
  const launcher = `try { $p = Start-Process -FilePath '${q(ps)}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${enc}'; exit $p.ExitCode } catch { exit 1223 }`;
  const r = await sys.run(ps, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", launcher], { timeout: 30 * 60 * 1000 });
  try {
    if (!fs.existsSync(out)) return r.code === 1223 ? { declined: true } : { ok: false, error: "O ajudante de administrador não respondeu (código " + r.code + ")" };
    const res = JSON.parse(fs.readFileSync(out, "utf8").replace(/^﻿/, ""));
    res.actions = Array.isArray(res.actions) ? res.actions : res.actions ? [res.actions] : [];
    return res;
  } finally { fs.rmSync(job, { force: true }); fs.rmSync(out, { force: true }); }
}

// teste (sem pedir permissão): roda o mesmo script como usuário comum, em pastas e chaves de teste
async function runAsUser(actions) {
  const dir = path.join(os.tmpdir(), "piphin-turbo");
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomBytes(6).toString("hex");
  const job = path.join(dir, `job-${id}.json`), out = path.join(dir, `res-${id}.json`);
  fs.writeFileSync(job, JSON.stringify({ actions }), "utf8");
  const q = (s) => s.replace(/'/g, "''");
  await sys.psRun(SCRIPT.replace("__JOB__", q(job)).replace("__OUT__", q(out)), 120000);
  const res = JSON.parse(fs.readFileSync(out, "utf8").replace(/^﻿/, ""));
  fs.rmSync(job, { force: true }); fs.rmSync(out, { force: true });
  res.actions = Array.isArray(res.actions) ? res.actions : [res.actions];
  return res;
}

module.exports = { runElevated, runAsUser };
