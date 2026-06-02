"""
THEIA - Logs query router with Pi node management
"""
import asyncio
import ipaddress
import socket
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from backend.database import get_db

router = APIRouter(prefix="/logs", tags=["logs"])


# ── Network helpers ─────────────────────────────────────────────
async def get_current_network_info() -> dict:
    """Get current network info (IP, subnet) of the HUB."""
    try:
        # Get local IP by connecting to a known address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return {"ip": local_ip, "subnet": ".".join(local_ip.split(".")[:3]) + ".0/24"}
    except Exception:
        return {"ip": "127.0.0.1", "subnet": "127.0.0.0/8"}


async def is_network_allowed() -> tuple[bool, str]:
    """Check if current network is in allowed_networks table."""
    db = await get_db()
    net_info = await get_current_network_info()
    current_ip = net_info["ip"]
    
    cursor = await db.execute("SELECT network_type, network_value FROM allowed_networks")
    allowed = await cursor.fetchall()
    
    for row in allowed:
        try:
            if row["network_type"] == "subnet":
                network = ipaddress.ip_network(row["network_value"], strict=False)
                if ipaddress.ip_address(current_ip) in network:
                    return True, row["network_value"]
        except Exception:
            continue
    
    return False, current_ip


async def resolve_device_host(node_id: str) -> dict | None:
    """Resolve device to SSH target from pi_nodes table."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT * FROM pi_nodes WHERE id = ?", (node_id,)
    )
    node = await cursor.fetchone()
    if not node:
        return None
    
    node_dict = dict(node)
    
    # If we have a recent IP (last_seen within 5 min), use it
    if node_dict.get("ip_address") and node_dict.get("online"):
        target = f"{node_dict['ssh_user']}@{node_dict['ip_address']}"
    else:
        # Fallback to hostname (Tailscale MagicDNS or mDNS)
        target = f"{node_dict['ssh_user']}@{node_dict['hostname']}"
    
    return {**node_dict, "target": target}


# ── Pydantic models ─────────────────────────────────────────────
class CommandRequest(BaseModel):
    device: str
    cmd: str


class HeartbeatRequest(BaseModel):
    node_id: str
    ip_address: str
    mac_address: str | None = None
    hostname: str | None = None


class NetworkRequest(BaseModel):
    network_type: str  # "subnet" or "ssid"
    network_value: str
    description: str | None = None


# ── Heartbeat endpoint (called by Pi nodes) ─────────────────────
@router.post("/heartbeat")
async def node_heartbeat(req: HeartbeatRequest, request: Request):
    """
    Pi nodes call this endpoint periodically to register their current IP.
    This allows dynamic IP tracking.
    """
    db = await get_db()
    
    # Update or insert the node's IP
    await db.execute("""
        UPDATE pi_nodes 
        SET ip_address = ?, 
            mac_address = COALESCE(?, mac_address),
            hostname = COALESCE(?, hostname),
            last_seen = datetime('now', 'localtime'),
            online = 1
        WHERE id = ?
    """, (req.ip_address, req.mac_address, req.hostname, req.node_id))
    await db.commit()
    
    return {"status": "ok", "node_id": req.node_id, "registered_ip": req.ip_address}


# ── Pi nodes management ─────────────────────────────────────────
@router.get("/nodes")
async def list_pi_nodes():
    """Return all Pi nodes with their current status."""
    db = await get_db()
    
    # Mark nodes as offline if not seen in 5 minutes
    await db.execute("""
        UPDATE pi_nodes 
        SET online = 0 
        WHERE last_seen < datetime('now', 'localtime', '-5 minutes')
    """)
    await db.commit()
    
    cursor = await db.execute("SELECT * FROM pi_nodes ORDER BY id")
    nodes = await cursor.fetchall()
    
    result = []
    for node in nodes:
        node_dict = dict(node)
        # Build SSH target
        if node_dict.get("ip_address") and node_dict.get("online"):
            node_dict["target"] = f"{node_dict['ssh_user']}@{node_dict['ip_address']}"
        else:
            node_dict["target"] = f"{node_dict['ssh_user']}@{node_dict['hostname']}"
        result.append(node_dict)
    
    return result


@router.put("/nodes/{node_id}")
async def update_pi_node(node_id: str, ip_address: str | None = None, ssh_user: str | None = None):
    """Manually update a Pi node's IP or SSH user."""
    db = await get_db()
    updates = []
    params = []
    
    if ip_address:
        updates.append("ip_address = ?")
        params.append(ip_address)
    if ssh_user:
        updates.append("ssh_user = ?")
        params.append(ssh_user)
    
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    params.append(node_id)
    await db.execute(f"UPDATE pi_nodes SET {', '.join(updates)} WHERE id = ?", params)
    await db.commit()
    
    return {"status": "updated", "node_id": node_id}


# ── Network management ──────────────────────────────────────────
@router.get("/networks")
async def list_allowed_networks():
    """Return allowed networks for SSH commands."""
    db = await get_db()
    cursor = await db.execute("SELECT * FROM allowed_networks")
    networks = await cursor.fetchall()
    
    # Add current network status
    is_allowed, current = await is_network_allowed()
    
    return {
        "allowed": [dict(n) for n in networks],
        "current": current,
        "is_allowed": is_allowed,
    }


@router.post("/networks")
async def add_allowed_network(req: NetworkRequest):
    """Add a new allowed network."""
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO allowed_networks (network_type, network_value, description) VALUES (?, ?, ?)",
            (req.network_type, req.network_value, req.description)
        )
        await db.commit()
        return {"status": "added", "network": req.network_value}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/networks/{network_id}")
async def remove_allowed_network(network_id: int):
    """Remove an allowed network."""
    db = await get_db()
    await db.execute("DELETE FROM allowed_networks WHERE id = ?", (network_id,))
    await db.commit()
    return {"status": "removed"}


# ── Command execution ───────────────────────────────────────────
@router.post("/command")
async def execute_command(req: CommandRequest):
    """Execute command on Pi Xaver/Hub via SSH. Requires allowed network."""
    device = req.device
    cmd = req.cmd
    
    # Check if on allowed network
    is_allowed, current_net = await is_network_allowed()
    if not is_allowed:
        return {
            "output": f"[BLOCKED] Current network ({current_net}) is not in allowed list.\nAdd it via Administration > Networks.",
            "returncode": 1,
            "network_error": True,
        }
    
    # Resolve device to SSH target
    node = await resolve_device_host(device)
    if not node:
        raise HTTPException(status_code=400, detail=f"Unknown device: {device}")
    
    ssh_target = node["target"]
    service = node.get("service_name", "xaver-detect")
    is_local = device == "hub"
    
    # Map command shortcuts to actual shell commands
    cmd_templates = {
        "status": "systemctl status {service}",
        "restart": "sudo systemctl restart {service}",
        "stop": "sudo systemctl stop {service}",
        "logs": "sudo journalctl -u {service} -n 50 --no-pager",
        "ps": "ps aux | grep -E '{service}|{process}'",
        "restart-api": "sudo systemctl restart theia-api",
    }
    
    process = "xaver" if "xaver" in device else "theia"
    template = cmd_templates.get(cmd)
    if not template:
        raise HTTPException(status_code=400, detail=f"Unknown command: {cmd}")
    
    shell_cmd = template.format(service=service, process=process)
    
    # For hub commands, run locally without SSH
    if is_local:
        full_cmd = shell_cmd
    else:
        full_cmd = f"ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o BatchMode=yes {ssh_target} '{shell_cmd}'"

    try:
        proc = await asyncio.create_subprocess_shell(
            full_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15.0)
        output = (stdout + stderr).decode("utf-8", errors="replace")
        return {"output": output, "returncode": proc.returncode, "target": ssh_target if not is_local else "localhost"}
    except asyncio.TimeoutError:
        return {"output": f"[TIMEOUT] Command to {ssh_target} took too long", "returncode": 1}
    except Exception as e:
        return {"output": f"[ERROR] {str(e)}", "returncode": 1}


@router.get("/devices")
async def get_control_devices():
    """Return available devices for control panel (alias for /nodes)."""
    return await list_pi_nodes()


# ── System logs ─────────────────────────────────────────────────
@router.get("/system")
async def system_logs(lines: int = 200, unit: str = "theia-api"):
    """Read Pi systemd journal logs for theia-api / theia-web / gpsd."""
    allowed_units = {"theia-api", "theia-web", "gpsd", "xaver-detect"}
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
