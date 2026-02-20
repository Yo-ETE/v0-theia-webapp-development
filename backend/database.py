"""
THEIA - SQLite database layer (async via aiosqlite)
"""
import os
import aiosqlite
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv("DB_PATH", "/opt/theia/data/theia.db")

_db: aiosqlite.Connection | None = None


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _db = await aiosqlite.connect(DB_PATH)
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA foreign_keys=ON")
        await init_tables(_db)
    return _db


async def close_db():
    global _db
    if _db:
        await _db.close()
        _db = None


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
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now')),
            started_at TEXT,
            ended_at TEXT
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
            floor INTEGER,
            position TEXT DEFAULT '',
            enabled INTEGER DEFAULT 1,
            rssi REAL DEFAULT 0,
            snr REAL DEFAULT 0,
            battery REAL DEFAULT 100,
            last_seen TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mission_id TEXT,
            device_id TEXT,
            event_type TEXT NOT NULL,
            zone TEXT DEFAULT '',
            rssi REAL,
            snr REAL,
            payload TEXT DEFAULT '{}',
            timestamp TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
            FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT DEFAULT 'info',
            source TEXT DEFAULT 'system',
            message TEXT NOT NULL,
            timestamp TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_events_mission ON events(mission_id);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source);
        CREATE INDEX IF NOT EXISTS idx_devices_mission ON devices(mission_id);
    """)
    await db.commit()

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
    # Device columns
    for col, dflt in [
        ("serial_port", "''"), ("zone_id", "''"), ("zone_label", "''"),
        ("side", "''"), ("sensor_position", "0.5"), ("floor", "NULL"),
    ]:
        try:
            await db.execute(f"ALTER TABLE devices ADD COLUMN {col} TEXT DEFAULT {dflt}")
        except Exception:
            pass
    await db.commit()
