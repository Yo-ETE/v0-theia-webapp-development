"""
THEIA - Auto-hotspot watchdog.

If the hub boots with no working network -- no Ethernet, no USB modem, and no internet
reachable by ping (a WiFi link that is associated but broken, e.g. a captive portal or a
dead upstream, counts as "no network" here) -- start the WiFi hotspot once after a grace
period, so the Pi can still be reached locally to fix the network.

Safety:
- Runs only within THEIA_AUTO_HOTSPOT_BOOT_WINDOW_S seconds of system uptime (default 300s /
  5 min). theia-api restarts on every OTA update and on "restart services" -- if this watchdog
  fired on every such restart instead of only on a real boot, it could tear down a perfectly
  working WiFi link hours into a session. Checking uptime instead of "time since this process
  started" means it fires once per physical/OS boot, not once per API restart.
- One-shot: does not keep toggling the radio during runtime. If you need continuous
  recovery (auto-stop the hotspot once real network returns), that is a separate feature.
- Disable with THEIA_AUTO_HOTSPOT=0. Tune the grace period with THEIA_AUTO_HOTSPOT_DELAY_S,
  the SSID with THEIA_AUTO_HOTSPOT_SSID. The passphrase is random, generated on first use and
  persisted to THEIA_DATA_DIR/hotspot_password.txt (0600) -- never a hardcoded default, since
  this source is public.
"""
import asyncio
import os

from backend.services.system_monitor import system_monitor

DELAY_S = float(os.getenv("THEIA_AUTO_HOTSPOT_DELAY_S", "45"))
BOOT_WINDOW_S = float(os.getenv("THEIA_AUTO_HOTSPOT_BOOT_WINDOW_S", "300"))
ENABLED = os.getenv("THEIA_AUTO_HOTSPOT", "1").strip().lower() not in ("0", "false", "no")
SSID = os.getenv("THEIA_AUTO_HOTSPOT_SSID", "THEIA")


def _has_working_network(net: dict) -> bool:
    """True if there is a real local (Ethernet/USB modem) or internet path.
    WiFi association alone does NOT count: a WiFi link with no internet behind it is
    exactly the "stuck, need local recovery access" case this watchdog exists for."""
    if net.get("ethernet", {}).get("connected"):
        return True
    if net.get("usb_modem", {}).get("connected"):
        return True
    if net.get("internet", {}).get("connected"):
        return True
    return False


async def run_once():
    """Wait for the grace period, then start the hotspot if nothing else is up. Fires at
    most once per process lifetime, and only near a real boot (see BOOT_WINDOW_S)."""
    if not ENABLED:
        return
    await asyncio.sleep(DELAY_S)

    data = system_monitor.data or {}
    uptime = data.get("uptime_seconds")
    if uptime is not None and uptime > BOOT_WINDOW_S:
        print(
            f"[THEIA] Auto-hotspot watchdog: system uptime {uptime:.0f}s > {BOOT_WINDOW_S:.0f}s, "
            "skipping (this is a service restart, not a fresh boot)",
            flush=True,
        )
        return

    net = data.get("network", {})
    if _has_working_network(net):
        return

    print(
        f"[THEIA] No working network {DELAY_S:.0f}s after boot (no ethernet, no usb modem, "
        "internet ping failed): starting recovery hotspot",
        flush=True,
    )
    try:
        # Imported lazily to avoid a hard import-time dependency between the two modules.
        from backend.routers.config import start_hotspot_blocking, _get_or_create_hotspot_password

        password = _get_or_create_hotspot_password()
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, start_hotspot_blocking, SSID, password)
        print(f"[THEIA] Auto-hotspot result: {result}", flush=True)

        try:
            from backend.database import get_db

            db = await get_db()
            level = "info" if result.get("status") == "success" else "warning"
            await db.execute(
                "INSERT INTO logs (level, source, message) VALUES (?, ?, ?)",
                (level, "network", f"Recovery hotspot auto-started (SSID={SSID}): {result.get('message', '')}"),
            )
            await db.commit()
        except Exception:
            pass
    except Exception as e:
        print(f"[THEIA] Auto-hotspot failed: {e}", flush=True)
