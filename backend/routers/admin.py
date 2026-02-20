"""
THEIA - Admin endpoints for system management
Reboot, shutdown, restart services, version info.
"""
import asyncio
import os
import subprocess
from fastapi import APIRouter

router = APIRouter(prefix="/api/admin")


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
    errors = []
    for svc in ["theia-api", "theia-web"]:
        try:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda s=svc: subprocess.run(
                    ["sudo", "systemctl", "restart", s],
                    check=True
                )
            )
        except Exception as e:
            errors.append(f"{svc}: {e}")
    if errors:
        return {"status": "error", "message": "; ".join(errors)}
    return {"status": "success", "message": "Services theia-api + theia-web redemarres"}


@router.get("/version")
async def version():
    """Get THEIA version info from git."""
    try:
        theia_dir = os.getenv("THEIA_DIR", "/opt/theia")

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
            subprocess.run(
                ["git", "fetch", "--quiet"],
                capture_output=True, text=True, cwd=theia_dir
            )
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
    try:
        theia_dir = os.getenv("THEIA_DIR", "/opt/theia/app")
        repo_dir = os.getenv("THEIA_REPO", os.path.expanduser("~/theia"))

        def _do_update():
            lines = []
            # Pull latest from git
            r = subprocess.run(
                ["git", "pull", "--ff-only"],
                capture_output=True, text=True, cwd=repo_dir
            )
            lines.append(r.stdout.strip())
            if r.returncode != 0:
                lines.append(r.stderr.strip())
                return "\n".join(lines)
            # Run install.sh
            r2 = subprocess.run(
                ["sudo", "bash", "install.sh"],
                capture_output=True, text=True, cwd=repo_dir,
                timeout=300,
            )
            lines.append(r2.stdout.strip()[-500:] if r2.stdout else "")
            if r2.returncode != 0:
                lines.append(r2.stderr.strip()[-200:] if r2.stderr else "")
            return "\n".join(lines)

        output = await asyncio.get_event_loop().run_in_executor(None, _do_update)
        return {"status": "success", "message": "Mise a jour terminee", "output": output}
    except Exception as e:
        return {"status": "error", "message": str(e)}
