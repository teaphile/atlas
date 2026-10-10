"""Small durable last-good cache; not a historical data lake.
WAL SQLite, bounded row count/total bytes, parsed source snapshots, not bulk response archives.
"""

import asyncio, sqlite3, threading, time
from pathlib import Path


class SnapshotStore:
    def __init__(self, path: str, max_entries: int = 384):
        self.path = path
        self.max_entries = max_entries
        self.lock = threading.Lock()
        self.db = None

    async def open(self):
        def work():
            if self.path != ":memory:":
                Path(self.path).parent.mkdir(parents=True, exist_ok=True)
            self.db = sqlite3.connect(self.path, check_same_thread=False)
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA busy_timeout=3000")
            self.db.execute(
                "CREATE TABLE IF NOT EXISTS snapshots (key TEXT PRIMARY KEY, body TEXT NOT NULL, saved REAL NOT NULL, expires REAL NOT NULL)"
            )
            self.db.execute("CREATE INDEX IF NOT EXISTS cache_saved ON snapshots(saved)")
            self.db.execute("DELETE FROM snapshots WHERE expires < ?", (time.time(),))
            self.db.commit()

        await asyncio.to_thread(work)

    async def load(self, key: str):
        def work():
            with self.lock:
                row = self.db.execute(
                    "SELECT body FROM snapshots WHERE key=? AND expires>?", (key, time.time())
                ).fetchone()
                return row[0] if row else None

        return await asyncio.to_thread(work)

    async def save(self, key: str, body: str, lifetime: int):
        if len(body.encode()) > 2_000_000:
            return

        def work():
            with self.lock:
                now = time.time()
                self.db.execute(
                    "INSERT INTO snapshots VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,saved=excluded.saved,expires=excluded.expires",
                    (key, body, now, now + lifetime),
                )
                self.db.execute("DELETE FROM snapshots WHERE expires<?", (now,))
                self.db.execute(
                    "DELETE FROM snapshots WHERE key IN (SELECT key FROM snapshots ORDER BY saved DESC LIMIT -1 OFFSET ?)",
                    (self.max_entries,),
                )
                total = self.db.execute(
                    "SELECT COALESCE(SUM(LENGTH(CAST(body AS BLOB))),0) FROM snapshots"
                ).fetchone()[0]
                while total > 48_000_000:
                    row = self.db.execute(
                        "SELECT key,LENGTH(CAST(body AS BLOB)) FROM snapshots ORDER BY saved LIMIT 1"
                    ).fetchone()
                    self.db.execute("DELETE FROM snapshots WHERE key=?", (row[0],))
                    total -= row[1]
                self.db.commit()

        await asyncio.to_thread(work)

    async def close(self):
        def work():
            with self.lock:
                if self.db:
                    self.db.close()
                    self.db = None

        await asyncio.to_thread(work)
