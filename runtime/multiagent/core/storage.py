import sqlite3
import json
from typing import Dict, Any, Optional, List
from pathlib import Path

class TaskStorage:
    """
    SQLite-backed persistent task and checkpoint storage for EditCore AI.
    Ensures zero state loss and supports task recovery after crashes.
    """
    def __init__(self, db_path: str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    assigned_agent TEXT,
                    input_data TEXT,
                    output_data TEXT,
                    error_message TEXT,
                    checkpoints TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()

    def create_task(self, task_id: str, title: str, input_data: Dict[str, Any], assigned_agent: Optional[str] = None):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO tasks (task_id, title, status, assigned_agent, input_data, checkpoints) VALUES (?, ?, ?, ?, ?, ?)",
                (task_id, title, "QUEUED", assigned_agent, json.dumps(input_data), json.dumps([]))
            )
            conn.commit()

    def update_status(self, task_id: str, status: str, output: Optional[Dict[str, Any]] = None, error: Optional[str] = None):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE tasks SET status = ?, output_data = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?",
                (status, json.dumps(output) if output else None, error, task_id)
            )
            conn.commit()

    def add_checkpoint(self, task_id: str, checkpoint_name: str, state_data: Dict[str, Any]):
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT checkpoints FROM tasks WHERE task_id = ?", (task_id,))
            row = cur.fetchone()
            if row:
                checkpoints = json.loads(row[0] or "[]")
                checkpoints.append({"checkpoint": checkpoint_name, "state": state_data})
                conn.execute(
                    "UPDATE tasks SET checkpoints = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?",
                    (json.dumps(checkpoints), task_id)
                )
                conn.commit()

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT * FROM tasks WHERE task_id = ?", (task_id,))
            row = cur.fetchone()
            if row:
                d = dict(row)
                d["input_data"] = json.loads(d["input_data"]) if d["input_data"] else {}
                d["output_data"] = json.loads(d["output_data"]) if d["output_data"] else None
                d["checkpoints"] = json.loads(d["checkpoints"]) if d["checkpoints"] else []
                return d
            return None

    def list_all_tasks(self, limit: int = 50) -> List[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (limit,))
            rows = cur.fetchall()
            results = []
            for r in rows:
                d = dict(r)
                d["input_data"] = json.loads(d["input_data"]) if d["input_data"] else {}
                d["output_data"] = json.loads(d["output_data"]) if d["output_data"] else None
                d["checkpoints"] = json.loads(d["checkpoints"]) if d["checkpoints"] else []
                results.append(d)
            return results

    def list_recoverable_tasks(self) -> List[Dict[str, Any]]:
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT * FROM tasks WHERE status IN ('QUEUED', 'RUNNING')")
            rows = cur.fetchall()
            results = []
            for r in rows:
                d = dict(r)
                d["input_data"] = json.loads(d["input_data"]) if d["input_data"] else {}
                d["output_data"] = json.loads(d["output_data"]) if d["output_data"] else None
                d["checkpoints"] = json.loads(d["checkpoints"]) if d["checkpoints"] else []
                results.append(d)
            return results
