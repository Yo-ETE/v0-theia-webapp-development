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
    """Restart THEIA backend services."""
    try:
        await asyncio.get_event_loop().run_in_executor(
            None, lambda: subprocess.run(
                ["sudo", "systemctl", "restart", "theia-backend"],
                check=True
            )
        )
        return {"status": "success", "message": "Services redemarres"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


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
    """Pull latest THEIA code from git and restart."""
    try:
        theia_dir = os.getenv("THEIA_DIR", "/opt/theia")

        def _do_update():
            result = subprocess.run(
                ["git", "pull", "--ff-only"],
                capture_output=True, text=True, cwd=theia_dir
            )
            return result.stdout + result.stderr

        output = await asyncio.get_event_loop().run_in_executor(None, _do_update)
        return {"status": "success", "message": "Mise a jour terminee", "output": output}
    except Exception as e:
        return {"status": "error", "message": str(e)}
