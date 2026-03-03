"""
THEIA - SQLite database layer (async via aiosqlite)
"""
import asyncio
import os
import aiosqlite
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv("DB_PATH", "/opt/theia/data/theia.db")

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is not None:
        try:
            await _db.execute("SELECT 1")
        except Exception:
            print("[THEIA] DB connection lost, reconnecting...")
            try:
                await _db.close()
            except Exception:
                pass
            _db = None
    if _db is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _db = await aiosqlite.connect(DB_PATH)
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA foreign_keys=ON")
        await _db.execute("PRAGMA busy_timeout=5000")
        await init_tables(_db)
    return _db


async def close_db():
    global _db
    if _db:
        await _db.close()
        _db = None


# ── Data retention ──────────────────────────────────────────
# Purge thresholds (days). Override via env: RETENTION_EVENTS_DAYS etc.
RETENTION_EVENTS = int(os.getenv("RETENTION_EVENTS_DAYS", "90"))
RETENTION_LOGS = int(os.getenv("RETENTION_LOGS_DAYS", "30"))
RETENTION_BATTERY = int(os.getenv("RETENTION_BATTERY_DAYS", "60"))
RETENTION_NOTIFS = int(os.getenv("RETENTION_NOTIFS_DAYS", "30"))

_PURGE_INTERVAL = 6 * 3600  # run every 6 hours


async def _purge_old_data():
    """Delete rows older than retention thresholds to keep SD card healthy."""
    while True:
        await asyncio.sleep(_PURGE_INTERVAL)
        try:
            db = await get_db()
            deleted = 0
            for table, col, days in [
                ("events", "timestamp", RETENTION_EVENTS),
                ("logs", "timestamp", RETENTION_LOGS),
                ("battery_history", "timestamp", RETENTION_BATTERY),
                ("notifications", "created_at", RETENTION_NOTIFS),
            ]:
                cur = await db.execute(
                    f"DELETE FROM {table} WHERE {col} < datetime('now', 'localtime', '-{days} days')"
                )
                deleted += cur.rowcount
            if deleted > 0:
                await db.commit()
                await db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                print(f"[THEIA] Retention purge: {deleted} old rows deleted")
        except Exception as e:
            print(f"[THEIA] Retention purge error: {e}")


def start_retention_job():
    """Call once at app startup to schedule periodic purges."""
    asyncio.ensure_future(_purge_old_data())


async def init_tables(db: aiosqlite.Connection):
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS missions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            status TEXT DEFAULT 'draft',
            location TEXT DEFAULT '',
            environment TEXT DEFAULT 'horizontal',
            center_lat REAL DEFAULT 48.8566,
            center_lon REAL DEFAULT 2.3522,
            zoom INTEGER DEFAULT 19,
            zones TEXT DEFAULT '[]',
            floors TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            started_at TEXT,
            ended_at TEXT,
            plan_image TEXT DEFAULT NULL,
            plan_width INTEGER DEFAULT NULL,
            plan_height INTEGER DEFAULT NULL
        );

        CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY,
            dev_eui TEXT UNIQUE,
            name TEXT NOT NULL,
            type TEXT DEFAULT 'microwave_tx',
            serial_port TEXT DEFAULT '',
            mission_id TEXT,
            zone TEXT DEFAULT '',
            zone_id TEXT DEFAULT '',
            zone_label TEXT DEFAULT '',
            side TEXT DEFAULT '',
            sensor_position REAL DEFAULT 0.5,
            orientation TEXT DEFAULT 'inward',
            muted INTEGER DEFAULT 0,
            floor INTEGER,
            position TEXT DEFAULT '',
            enabled INTEGER DEFAULT 1,
            rssi REAL DEFAULT 0,
            snr REAL DEFAULT 0,
            battery REAL DEFAULT 100,
            last_seen TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mission_id TEXT,
            device_id TEXT,
            event_type TEXT NOT NULL,
            zone TEXT DEFAULT '',
            zone_id TEXT DEFAULT '',
            side TEXT DEFAULT '',
            rssi REAL,
            snr REAL,
            payload TEXT DEFAULT '{}',
            timestamp TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT DEFAULT 'info',
            source TEXT DEFAULT 'system',
            message TEXT NOT NULL,
            timestamp TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            severity TEXT DEFAULT 'warning',
            device_id TEXT,
            device_name TEXT,
            message TEXT NOT NULL,
            read INTEGER DEFAULT 0,
            dismissed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        );

        CREATE TABLE IF NOT EXISTS battery_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            voltage REAL NOT NULL,
            timestamp TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_events_mission ON events(mission_id);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source);
        CREATE INDEX IF NOT EXISTS idx_devices_mission ON devices(mission_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_dismissed ON notifications(dismissed);
        CREATE INDEX IF NOT EXISTS idx_battery_history_device ON battery_history(device_id);
        CREATE INDEX IF NOT EXISTS idx_battery_history_ts ON battery_history(timestamp);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            last_login TEXT
        );

        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    """)
    await db.commit()

    # Create default admin account if no users exist
    cursor = await db.execute("SELECT COUNT(*) FROM users")
    count = (await cursor.fetchone())[0]
    if count == 0:
        # PBKDF2 hash of "admin" -- same algorithm as auth.py _hash_password
        import secrets as _secrets
        import hashlib as _hashlib
        _salt = _secrets.token_hex(16)
        _dk = _hashlib.pbkdf2_hmac("sha256", b"admin", _salt.encode(), 100_000)
        _hash = f"{_salt}${_dk.hex()}"
        await db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ("admin", _hash, "admin")
        )
        await db.commit()
        print("[THEIA] Default admin account created (username: admin, password: admin)")

    # Migrations for existing databases
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN environment TEXT DEFAULT 'horizontal'")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN center_lat REAL DEFAULT 48.8566")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN center_lon REAL DEFAULT 2.3522")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN zoom INTEGER DEFAULT 19")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN floors TEXT DEFAULT '[]'")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN started_at TEXT")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN ended_at TEXT")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN location TEXT DEFAULT ''")
    except Exception:
        pass
    # Device TEXT columns
    for col, dflt in [
        ("serial_port", "''"), ("zone_id", "''"), ("zone_label", "''"),
        ("side", "''"), ("floor", "NULL"),
    ]:
        try:
            await db.execute(f"ALTER TABLE devices ADD COLUMN {col} TEXT DEFAULT {dflt}")
        except Exception:
            pass
    # Device REAL columns
    try:
        await db.execute("ALTER TABLE devices ADD COLUMN sensor_position REAL DEFAULT 0.5")
    except Exception:
        pass
    # Device orientation column
    try:
        await db.execute("ALTER TABLE devices ADD COLUMN orientation TEXT DEFAULT 'inward'")
    except Exception:
        pass
    # Device muted column
    try:
        await db.execute("ALTER TABLE devices ADD COLUMN muted INTEGER DEFAULT 0")
    except Exception:
        pass
    # Mission plan_image columns
    for col, dflt in [("plan_image", "NULL"), ("plan_width", "NULL"), ("plan_height", "NULL")]:
        try:
            await db.execute(f"ALTER TABLE missions ADD COLUMN {col} {'TEXT' if col == 'plan_image' else 'INTEGER'} DEFAULT {dflt}")
        except Exception:
            pass
    # Mission plan_scale (pixels per metre for calibrated plans)
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN plan_scale REAL DEFAULT NULL")
    except Exception:
        pass
    # Mission detection_reset_at (ISO timestamp: ignore events before this)
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN detection_reset_at TEXT DEFAULT NULL")
    except Exception:
        pass
    # Events columns
    for col in ["zone_id", "side"]:
        try:
            await db.execute(f"ALTER TABLE events ADD COLUMN {col} TEXT DEFAULT ''")
        except Exception:
            pass
    # Events: store sensor position/orientation at detection time (for historical replay)
    try:
        await db.execute("ALTER TABLE events ADD COLUMN sensor_position REAL DEFAULT NULL")
    except Exception:
        pass
    try:
        await db.execute("ALTER TABLE events ADD COLUMN orientation TEXT DEFAULT NULL")
    except Exception:
        pass
    # Events: store floor level at detection time (for floor-mode replay without TX assigned)
    try:
        await db.execute("ALTER TABLE events ADD COLUMN floor INTEGER DEFAULT NULL")
    except Exception:
        pass
    # Events: store device_name at detection time (so replay shows correct name even if TX reassigned)
    try:
        await db.execute("ALTER TABLE events ADD COLUMN device_name TEXT DEFAULT NULL")
    except Exception:
        pass
    # Mission visual_config (per-mission visual overrides as JSON)
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN visual_config TEXT DEFAULT NULL")
    except Exception:
        pass
    # Mission device_placements (persists TX positions for replay after unassignment)
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN device_placements TEXT DEFAULT '{}'")
    except Exception:
        pass
    # Mission notification_config (JSON: notification rules per mission)
    try:
        await db.execute("ALTER TABLE missions ADD COLUMN notification_config TEXT DEFAULT NULL")
    except Exception:
        pass
    await db.commit()
