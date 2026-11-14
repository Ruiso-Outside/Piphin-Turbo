# Piphin Turbo · ajudante de administrador do Linux (roda pelo pkexec, com UMA senha para tudo).
# Só faz o que está na lista abaixo, mesmo que o pedido traga outra coisa:
#   del     apaga arquivos antigos dentro de /var/cache/apt/archives e /var/crash; o journal é encolhido pelo journalctl
#   write   grava só o arquivo /etc/sysctl.d/99-piphin-turbo.conf
#   remove  apaga só esse mesmo arquivo
#   cmd     roda só sysctl, apt-get install/remove gamemode e journalctl
# Uso: pkexec python3 -I linux-helper.py <pedido.json> <resposta.json>
import json
import os
import subprocess
import sys
import time

DEL_DIRS = {"/var/cache/apt/archives", "/var/crash", "/var/log/journal"}
FILES = {"/etc/sysctl.d/99-piphin-turbo.conf"}


def allowed_cmd(argv):
    if not argv:
        return False
    if argv[0] == "sysctl":
        return len(argv) == 3 and argv[1] == "-w" and argv[2].startswith("vm.swappiness=") and argv[2].split("=")[1].isdigit()
    if argv[0] == "apt-get":
        return argv[1:] in (["install", "-y", "gamemode"], ["remove", "-y", "gamemode"])
    return False


def du(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def delete_old(d, min_age_ms):
    limit = time.time() - (min_age_ms or 0) / 1000
    freed = count = 0
    for root, _dirs, files in os.walk(d):
        if os.path.basename(root) == "partial":
            continue
        for f in files:
            p = os.path.join(root, f)
            if f == "lock" or os.path.islink(p):
                continue
            if d == "/var/cache/apt/archives" and not f.endswith(".deb"):
                continue
            try:
                st = os.lstat(p)
                if st.st_mtime > limit:
                    continue
                os.unlink(p)
                freed += st.st_size
                count += 1
            except OSError:
                pass
    return freed, count


def main():
    job, out = sys.argv[1], sys.argv[2]
    with open(job, encoding="utf-8") as fh:
        actions = json.load(fh).get("actions", [])
    res = {"ok": True, "actions": []}
    for a in actions:
        r = {"type": a.get("type"), "ok": True, "bytes": 0, "files": 0, "error": ""}
        try:
            t = a.get("type")
            if t == "del":
                for d in a.get("dirs", []):
                    d = os.path.realpath(d)
                    if d not in DEL_DIRS or not os.path.isdir(d):
                        continue
                    if d == "/var/log/journal":
                        before = du(d)
                        subprocess.run(["journalctl", "--vacuum-time=14d"], capture_output=True, timeout=300)
                        r["bytes"] += max(0, before - du(d))
                    else:
                        b, n = delete_old(d, a.get("minAgeMs", 0))
                        r["bytes"] += b
                        r["files"] += n
            elif t == "write":
                if a.get("file") not in FILES:
                    raise ValueError("arquivo não permitido")
                with open(a["file"], "w", encoding="utf-8") as fh:
                    fh.write(str(a.get("content", "")))
            elif t == "remove":
                if a.get("file") not in FILES:
                    raise ValueError("arquivo não permitido")
                if os.path.exists(a["file"]):
                    os.unlink(a["file"])
            elif t == "cmd":
                argv = [str(x) for x in a.get("argv", [])]
                if not allowed_cmd(argv):
                    raise ValueError("comando não permitido: " + " ".join(argv[:2]))
                env = {**os.environ, **{k: str(v) for k, v in (a.get("env") or {}).items() if k == "DEBIAN_FRONTEND"}}
                p = subprocess.run(argv, capture_output=True, text=True, timeout=1200, env=env)
                if p.returncode != 0:
                    raise RuntimeError((p.stderr or p.stdout).strip()[-300:])
            else:
                raise ValueError("ação desconhecida")
        except Exception as e:  # noqa: BLE001
            r["ok"], r["error"] = False, str(e)
        res["actions"].append(r)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(res, fh)
    # a resposta é lida pelo usuário que pediu
    try:
        os.chown(out, os.stat(job).st_uid, os.stat(job).st_gid)
    except OSError:
        pass


if __name__ == "__main__":
    main()
