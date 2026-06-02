"""
THEIA - Logs query router
"""
import asyncio
import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.database import get_db

router = APIRouter(prefix="/logs", tags=["logs"])

# Device hosts - can be Tailscale hostnames or IPs
# These resolve via Tailscale MagicDNS or local network
DEVICE_HOSTS = {
    "xaver01": "theia-xaver@theia-xaver01",  # Tailscale hostname
    "xaver02": "theia-xaver@theia-xaver02",  # Tailscale hostname
    "hub": "theia@theia",                     # Hub is localhost or Tailscale
}

# Fallback IPs (local network 192.168.84.x)
FALLBACK_IPS = {
    "xaver01": "theia-xaver@192.168.84.111",
    "xaver02": "theia-xaver@192.168.84.242",
    "hub": "theia@192.168.84.179",
}


async def get_tailscale_peers() -> dict:
    """Get Tailscale peer IPs from tailscale status."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "tailscale", "status", "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        data = json.loads(stdout.decode())
        peers = {}
        for peer_id, peer in data.get("Peer", {}).items():
            hostname = peer.get("HostName", "").lower()
            ips = peer.get("TailscaleIPs", [])
            if hostname and ips:
                peers[hostname] = ips[0]  # First IP (usually IPv4)
        # Add self
        self_node = data.get("Self", {})
        if self_node:
            hostname = self_node.get("HostName", "").lower()
            ips = self_node.get("TailscaleIPs", [])
            if hostname and ips:
                peers[hostname] = ips[0]
        return peers
    except Exception:
        return {}


async def resolve_device_host(device: str) -> str:
    """Resolve device to SSH target (user@host)."""
    # Try Tailscale first
    peers = await get_tailscale_peers()
    
    # Map device names to expected Tailscale hostnames
    ts_hostname_map = {
        "xaver01": "theia-xaver01",
        "xaver02": "theia-xaver02", 
        "hub": "theia",
    }
    
    ts_hostname = ts_hostname_map.get(device)
    if ts_hostname and ts_hostname in peers:
        user = "theia-xaver" if "xaver" in device else "theia"
        return f"{user}@{peers[ts_hostname]}"
    
    # Fallback to local network IPs
    return FALLBACK_IPS.get(device, FALLBACK_IPS.get("hub", ""))


class CommandRequest(BaseModel):
    device: str
    cmd: str


@router.get("/system")
async def system_logs(lines: int = 200, unit: str = "theia-api"):
    """Read Pi systemd journal logs for theia-api / theia-web / gpsd."""
    allowed_units = {"theia-api", "theia-web", "gpsd"}
    if unit not in allowed_units:
        unit = "theia-api"
    try:
        proc = await asyncio.create_subprocess_exec(
            "journalctl", "-u", unit, "-n", str(min(lines, 500)),
            "--no-pager", "--output=short-iso",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5.0)
        raw = stdout.decode("utf-8", errors="replace").strip().split("\n")
        return [{"line": l} for l in raw if l]
    except Exception as e:
        return [{"line": f"[ERROR] {e}"}]


@router.get("/sources")
async def list_sources():
    """Return distinct log sources from DB."""
    db = await get_db()
    cursor = await db.execute("SELECT DISTINCT source FROM logs ORDER BY source")
    rows = await cursor.fetchall()
    return [r["source"] for r in rows]


@router.get("")
async def list_logs(
    source: str | None = None,
    level: str | None = None,
    search: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    db = await get_db()
    conditions = []
    params: list = []

    if source:
        conditions.append("source=?")
        params.append(source)
    if level:
        conditions.append("level=?")
        params.append(level)
    if search:
        conditions.append("message LIKE ?")
        params.append(f"%{search}%")

    where = " AND ".join(conditions) if conditions else "1=1"
    query = f"SELECT * FROM logs WHERE {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    cursor = await db.execute(query, params)
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


@router.post("/command")
async def execute_command(req: CommandRequest):
    """Execute command on Pi Xaver/Hub via SSH. Allowed commands only."""
    device = req.device
    cmd = req.cmd
    
    # Resolve device to SSH target
    ssh_target = await resolve_device_host(device)
    if not ssh_target:
        raise HTTPException(status_code=400, detail=f"Unknown device: {device}")
    
    # Map command shortcuts to actual shell commands
    cmd_templates = {
        "status": "systemctl status {service}",
        "restart": "sudo systemctl restart {service}",
        "stop": "sudo systemctl stop {service}",
        "logs": "sudo journalctl -u {service} -n 50 --no-pager",
        "ps": "ps aux | grep {process}",
        "restart-api": "sudo systemctl restart theia-api",
    }
    
    # Determine service/process based on device
    if "xaver" in device:
        service = "xaver-detect"
        process = "xaver"
    else:
        service = "theia-api"
        process = "theia"
    
    template = cmd_templates.get(cmd)
    if not template:
        raise HTTPException(status_code=400, detail=f"Unknown command: {cmd}")
    
    shell_cmd = template.format(service=service, process=process)
    full_cmd = f"ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no {ssh_target} '{shell_cmd}'"

    try:
        proc = await asyncio.create_subprocess_shell(
            full_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15.0)
        output = (stdout + stderr).decode("utf-8", errors="replace")
        return {"output": output, "returncode": proc.returncode, "target": ssh_target}
    except asyncio.TimeoutError:
        return {"output": f"[TIMEOUT] SSH to {ssh_target} took too long", "returncode": 1}
    except Exception as e:
        return {"output": f"[ERROR] {str(e)}", "returncode": 1}


@router.get("/devices")
async def get_control_devices():
    """Return available devices for control panel with their resolved IPs."""
    devices = []
    for dev_id in ["xaver01", "xaver02", "hub"]:
        target = await resolve_device_host(dev_id)
        devices.append({
            "id": dev_id,
            "name": f"TX-XAVER0{dev_id[-1]}" if "xaver" in dev_id else "HUB",
            "target": target,
            "type": "xaver" if "xaver" in dev_id else "hub",
        })
    return devices
