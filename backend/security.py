"""
THEIA - Shared input validation and origin checks.

Everything that ends up in a subprocess argv, a filesystem path or a source file
must pass through one of these validators first.
"""
import ipaddress
import os
import re

# ── CORS ────────────────────────────────────────────────────────
# Allowed browser origins: loopback, RFC1918, Tailscale (100.64/10 and *.ts.net),
# mDNS (*.local) and single-label hostnames (MagicDNS short names, e.g. http://theia:3000).
# A public website always has a dotted hostname, so it never matches.
CORS_ORIGIN_REGEX = (
    r"^https?://("
    r"localhost|127\.0\.0\.1|\[::1\]"
    r"|[a-z0-9-]+"
    r"|[a-z0-9-]+\.local"
    r"|([a-z0-9-]+\.)+ts\.net"
    r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r"|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}"
    r")(:\d{1,5})?$"
)
_CORS_RE = re.compile(CORS_ORIGIN_REGEX, re.IGNORECASE)
# Extra origins (comma-separated), e.g. a custom domain in front of the hub.
_EXTRA_ORIGINS = {
    o.strip().rstrip("/").lower()
    for o in os.getenv("THEIA_CORS_ORIGINS", "").split(",")
    if o.strip()
}


def is_allowed_origin(origin: str) -> bool:
    if not origin:
        return False
    return bool(_CORS_RE.match(origin)) or origin.rstrip("/").lower() in _EXTRA_ORIGINS


def cors_origin_regex() -> str:
    """Regex for CORSMiddleware, including THEIA_CORS_ORIGINS."""
    if not _EXTRA_ORIGINS:
        return f"(?i){CORS_ORIGIN_REGEX}"
    extra = "|".join(re.escape(o) for o in sorted(_EXTRA_ORIGINS))
    return f"(?i){CORS_ORIGIN_REGEX}|^(?:{extra})$"


# ── Identifiers ─────────────────────────────────────────────────
_SKETCH_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
_TX_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,16}$")
_SSH_USER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,31}$")
_HOSTNAME_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")
_SERVICE_RE = re.compile(r"^[A-Za-z0-9_.@-]{1,64}$")
_FQBN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:=,-]{0,127}$")
_SENSOR_TYPE_RE = re.compile(r"^[a-z0-9_]{1,32}$")
_SERIAL_PORT_RE = re.compile(
    r"^/dev/(ttyUSB\d{1,3}|ttyACM\d{1,3}|serial/by-id/[A-Za-z0-9_.:-]{1,128})$"
)


def valid_sketch_name(name: str) -> bool:
    return bool(_SKETCH_NAME_RE.match(name or "")) and ".." not in name


def valid_tx_id(value: str) -> bool:
    return bool(_TX_ID_RE.match(value or ""))


def valid_ssh_user(value: str) -> bool:
    return bool(_SSH_USER_RE.match(value or ""))


def valid_service_name(value: str) -> bool:
    return bool(_SERVICE_RE.match(value or ""))


def valid_fqbn(value: str) -> bool:
    return bool(_FQBN_RE.match(value or ""))


def valid_sensor_type(value: str) -> bool:
    return bool(_SENSOR_TYPE_RE.match(value or ""))


def valid_serial_port(value: str) -> bool:
    return bool(_SERIAL_PORT_RE.match(value or "")) and ".." not in value


def valid_host(value: str) -> bool:
    """IPv4/IPv6 literal or plain hostname (no shell metacharacters, no leading '-')."""
    if not value:
        return False
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        pass
    return bool(_HOSTNAME_RE.match(value))


def is_within(base: str, candidate: str) -> bool:
    """True if candidate resolves to a path strictly inside base (symlinks resolved)."""
    base_real = os.path.realpath(base)
    cand_real = os.path.realpath(candidate)
    return cand_real != base_real and os.path.commonpath([base_real, cand_real]) == base_real


# ── Admin / system operations ────────────────────────────────────
_GIT_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$")
_TZ_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_+/-]{0,63}$")
_BACKUP_RE = re.compile(r"^theia_backup_[A-Za-z0-9_.-]{1,64}\.tar\.gz$")


def valid_git_ref(ref: str) -> bool:
    """Branch / tag name that cannot be read as a git option (no leading '-')."""
    return bool(_GIT_REF_RE.match(ref or "")) and ".." not in ref


def valid_timezone(tz: str) -> bool:
    return bool(_TZ_RE.match(tz or "")) and ".." not in tz


def valid_backup_filename(name: str) -> bool:
    return bool(_BACKUP_RE.match(name or "")) and ".." not in name


def valid_ssid(ssid: str) -> bool:
    """1-32 bytes, printable, no newline (it is written into hostapd/nmcli config), not an option."""
    if not ssid or ssid.startswith("-") or len(ssid.encode("utf-8", "ignore")) > 32:
        return False
    return ssid.isprintable()


def valid_wpa_passphrase(pw: str) -> bool:
    """WPA2 passphrase: 8-63 printable ASCII characters (no newline injection into hostapd.conf)."""
    return 8 <= len(pw or "") <= 63 and all(32 <= ord(c) < 127 for c in pw)


import threading

# One system update at a time (double click / two admins would run install.sh twice in parallel)
UPDATE_LOCK = threading.Lock()
