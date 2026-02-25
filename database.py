"""SQLite database layer for watchlist tabs and tickers."""

import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "watchlist.db")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """Create tables if they don't exist. Migrate old data if needed."""
    conn = get_db()

    # Tabs table
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tabs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Watchlist table with tab_id foreign key
    # ticker is unique PER TAB (not globally)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tab_id INTEGER NOT NULL,
            ticker TEXT NOT NULL,
            name TEXT,
            sort_order INTEGER DEFAULT 0,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tab_id) REFERENCES tabs(id) ON DELETE CASCADE,
            UNIQUE(tab_id, ticker)
        )
    """)
    conn.commit()

    # Migration: add sort_order column if it doesn't exist (for existing DBs)
    try:
        conn.execute("SELECT sort_order FROM watchlist LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE watchlist ADD COLUMN sort_order INTEGER DEFAULT 0")
        conn.commit()
        # Back-fill sort_order based on existing added_at order
        rows = conn.execute(
            "SELECT id, tab_id FROM watchlist ORDER BY tab_id, added_at"
        ).fetchall()
        cur_tab = None
        order = 0
        for row in rows:
            if row["tab_id"] != cur_tab:
                cur_tab = row["tab_id"]
                order = 0
            conn.execute("UPDATE watchlist SET sort_order = ? WHERE id = ?", (order, row["id"]))
            order += 1
        conn.commit()

    # If no tabs exist, seed with defaults from seed_data.py
    tab_count = conn.execute("SELECT COUNT(*) FROM tabs").fetchone()[0]
    if tab_count == 0:
        from seed_data import DEFAULT_TABS, DEFAULT_WATCHLIST

        # Create all default tabs
        for tab_def in DEFAULT_TABS:
            conn.execute(
                "INSERT INTO tabs (name, sort_order) VALUES (?, ?)",
                (tab_def["name"], tab_def["sort_order"]),
            )
        conn.commit()

        # Add tickers to each tab
        tabs = conn.execute("SELECT id, name FROM tabs").fetchall()
        tab_map = {row["name"]: row["id"] for row in tabs}

        for tab_name, tickers in DEFAULT_WATCHLIST.items():
            tab_id = tab_map.get(tab_name)
            if not tab_id:
                continue
            for order, (ticker, name) in enumerate(tickers):
                conn.execute(
                    "INSERT OR IGNORE INTO watchlist (tab_id, ticker, name, sort_order) VALUES (?, ?, ?, ?)",
                    (tab_id, ticker, name, order),
                )
        conn.commit()

    conn.close()


# ── Tab operations ─────────────────────────────────────────────────────────

def get_tabs() -> list[dict]:
    conn = get_db()
    rows = conn.execute("SELECT id, name, sort_order FROM tabs ORDER BY sort_order, id").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_tab(name: str) -> dict:
    conn = get_db()
    max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM tabs").fetchone()[0]
    cursor = conn.execute(
        "INSERT INTO tabs (name, sort_order) VALUES (?, ?)",
        (name.strip(), max_order + 1),
    )
    conn.commit()
    tab_id = cursor.lastrowid
    conn.close()
    return {"id": tab_id, "name": name.strip(), "sort_order": max_order + 1}


def rename_tab(tab_id: int, new_name: str) -> bool:
    conn = get_db()
    cursor = conn.execute("UPDATE tabs SET name = ? WHERE id = ?", (new_name.strip(), tab_id))
    conn.commit()
    updated = cursor.rowcount > 0
    conn.close()
    return updated


def delete_tab(tab_id: int) -> bool:
    conn = get_db()
    # Don't delete the last remaining tab
    count = conn.execute("SELECT COUNT(*) FROM tabs").fetchone()[0]
    if count <= 1:
        conn.close()
        return False
    cursor = conn.execute("DELETE FROM tabs WHERE id = ?", (tab_id,))
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted


# ── Watchlist operations (tab-scoped) ──────────────────────────────────────

def get_watchlist(tab_id: int) -> list[dict]:
    conn = get_db()
    rows = conn.execute(
        "SELECT id, tab_id, ticker, name FROM watchlist WHERE tab_id = ? ORDER BY sort_order, added_at",
        (tab_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_ticker(tab_id: int, ticker: str, name: str = "") -> bool:
    conn = get_db()
    try:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM watchlist WHERE tab_id = ?",
            (tab_id,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO watchlist (tab_id, ticker, name, sort_order) VALUES (?, ?, ?, ?)",
            (tab_id, ticker.upper().strip(), name, max_order + 1),
        )
        conn.commit()
        conn.close()
        return True
    except sqlite3.IntegrityError:
        conn.close()
        return False


def reorder_watchlist(tab_id: int, tickers: list[str]) -> bool:
    """Update sort_order for all tickers in a tab based on the provided order."""
    conn = get_db()
    for i, ticker in enumerate(tickers):
        conn.execute(
            "UPDATE watchlist SET sort_order = ? WHERE tab_id = ? AND ticker = ?",
            (i, tab_id, ticker.upper().strip()),
        )
    conn.commit()
    conn.close()
    return True


def remove_ticker(tab_id: int, ticker: str) -> bool:
    conn = get_db()
    cursor = conn.execute(
        "DELETE FROM watchlist WHERE tab_id = ? AND ticker = ?",
        (tab_id, ticker.upper().strip()),
    )
    conn.commit()
    deleted = cursor.rowcount > 0
    conn.close()
    return deleted
