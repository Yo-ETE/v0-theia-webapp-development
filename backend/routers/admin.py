"""
THEIA - Admin endpoints for system management
Reboot, shutdown, restart services, version info.
"""
import asyncio
import os
import subprocess
from fastapi import APIRouter

from backend.security import UPDATE_LOCK

router = APIRouter(prefix="/api/admin")


def _git_dir() -> str:
    """Directory holding the git checkout. /opt/theia/app is rsync'ed without .git,
    so prefer the source repo (THEIA_REPO) and fall back to THEIA_DIR."""
    candidates = [
        os.getenv("THEIA_REPO", os.path.expanduser("~/theia")),
        os.getenv("THEIA_DIR", "/opt/theia/app"),
        "/opt/theia",
    ]
    for c in candidates:
        if c and os.path.isdir(os.path.join(c, ".git")):
            return c
    return candidates[0]


@router.post("/reboot")
async def reboot():
    """Reboot the Raspberry Pi."""
    try:
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: subprocess.run(["sudo", "reboot"], check=True)
        )
        return {"status": "success", "message": "Redemarrage en cours..."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.post("/shutdown")
async def shutdown():
    """Shutdown the Raspberry Pi."""
    try:
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: subprocess.run(["sudo", "shutdown", "-h", "now"], check=True)
        )
        return {"status": "success", "message": "Arret en cours..."}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.post("/restart-services")
async def restart_services():
    """Restart THEIA services (theia-api + theia-web)."""
    try:
        await asyncio.get_running_loop().run_in_executor(
            None, lambda: subprocess.run(
                ["sudo", "systemctl", "restart", "theia-web"], check=True, timeout=60
            )
        )
    except Exception as e:
        return {"status": "error", "message": f"theia-web: {e}"}
    # Restarting theia-api kills this very process: schedule it detached so the response gets out first
    subprocess.Popen(
        ["bash", "-c", "sleep 2 && sudo systemctl restart theia-api"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
    )
    return {"status": "success", "message": "theia-web redemarre, theia-api redemarre dans 2 secondes"}


@router.get("/version")
async def version():
    """Get THEIA version info from git."""
    try:
        theia_dir = _git_dir()

        def _get_version():
            branch = subprocess.run(
                ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                capture_output=True, text=True, cwd=theia_dir
            ).stdout.strip()

            commit = subprocess.run(
                ["git", "rev-parse", "--short", "HEAD"],
                capture_output=True, text=True, cwd=theia_dir
            ).stdout.strip()

            commit_date = subprocess.run(
                ["git", "log", "-1", "--format=%ci"],
                capture_output=True, text=True, cwd=theia_dir
            ).stdout.strip()

            # Check for updates
            try:
                subprocess.run(
                    ["git", "fetch", "--quiet"],
                    capture_output=True, text=True, cwd=theia_dir, timeout=15
                )
            except subprocess.TimeoutExpired:
                pass  # offline: report the version we have, without update info
            behind = subprocess.run(
                ["git", "rev-list", "--count", f"HEAD..origin/{branch}"],
                capture_output=True, text=True, cwd=theia_dir
            ).stdout.strip()

            return {
                "branch": branch,
                "commit": commit,
                "commitDate": commit_date,
                "updateAvailable": int(behind or "0") > 0,
                "commitsBehind": int(behind or "0"),
            }

        data = await asyncio.get_event_loop().run_in_executor(None, _get_version)
        return data
    except Exception as e:
        return {"branch": "unknown", "commit": "unknown", "commitDate": None,
                "updateAvailable": False, "commitsBehind": 0, "error": str(e)}


@router.post("/update")
async def update():
    """Pull latest THEIA code from git and run install.sh."""
    repo_dir = _git_dir()

    def _do_update():
        if not UPDATE_LOCK.acquire(blocking=False):
            return "error", "Une mise a jour est deja en cours", ""
        try:
            lines = []
            r = subprocess.run(
                ["git", "pull", "--ff-only"],
                capture_output=True, text=True, cwd=repo_dir, timeout=120
            )
            lines.append(r.stdout.strip())
            if r.returncode != 0:
                lines.append(r.stderr.strip())
                return "error", "git pull --ff-only a echoue (depot local divergent ?)", "\n".join(lines)
            r2 = subprocess.run(
                ["sudo", "bash", "install.sh"],
                capture_output=True, text=True, cwd=repo_dir,
                timeout=1200,  # apt + pip + pnpm build on a Pi can exceed 5 minutes
            )
            lines.append(r2.stdout.strip()[-500:] if r2.stdout else "")
            if r2.returncode != 0:
                lines.append(r2.stderr.strip()[-200:] if r2.stderr else "")
                return "error", f"install.sh a echoue (code {r2.returncode})", "\n".join(lines)
            return "success", "Mise a jour terminee", "\n".join(lines)
        except subprocess.TimeoutExpired as e:
            return "error", f"Delai depasse: {e.cmd[0]} (verifiez l'etat du build avant de relancer)", ""
        finally:
            UPDATE_LOCK.release()

    try:
        status, message, output = await asyncio.get_running_loop().run_in_executor(None, _do_update)
        return {"status": status, "message": message, "output": output}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ── SMS Configuration ──

import json
from fastapi import Request, HTTPException

@router.get("/sms-config")
async def get_sms_config():
    """Get SMS provider configuration."""
    from backend.database import get_db
    db = await get_db()
    cursor = await db.execute("SELECT value FROM settings WHERE key='sms_config'")
    row = await cursor.fetchone()
    if not row:
        return {"provider": ""}
    try:
        return json.loads(row["value"])
    except Exception:
        return {"provider": ""}


@router.post("/sms-config")
async def save_sms_config(request: Request):
    """Save SMS provider configuration."""
    from backend.database import get_db
    body = await request.json()
    db = await get_db()
    config_json = json.dumps(body)
    # Upsert
    existing = await db.execute("SELECT key FROM settings WHERE key='sms_config'")
    if await existing.fetchone():
        await db.execute("UPDATE settings SET value=? WHERE key='sms_config'", (config_json,))
    else:
        await db.execute("INSERT INTO settings (key, value) VALUES ('sms_config', ?)", (config_json,))
    await db.commit()
    return {"ok": True}


@router.post("/sms-test")
async def test_sms():
    """Send a test SMS using the configured provider."""
    from backend.database import get_db
    db = await get_db()
    cursor = await db.execute("SELECT value FROM settings WHERE key='sms_config'")
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Aucun provider SMS configure")
    try:
        config = json.loads(row["value"])
    except Exception:
        raise HTTPException(status_code=400, detail="Configuration SMS invalide")

    if not config.get("provider"):
        raise HTTPException(status_code=400, detail="Aucun provider SMS selectionne")

    from backend.services.sms_service import send_sms
    ok = await send_sms("THEIA - Notification test. Tout fonctionne !", config)
    if ok:
        return {"ok": True}
    raise HTTPException(status_code=500, detail="Echec de l'envoi du SMS de test")
