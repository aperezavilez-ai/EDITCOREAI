import os
import shutil
from pathlib import Path

class WorkspaceManager:
    """
    Manages isolated task workspaces for multi-agent execution in EditCore AI.
    Prevents concurrent agents from colliding on shared files.
    """
    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def create_workspace(self, task_id: str) -> Path:
        ws_path = self.base_dir / f"task_{task_id}"
        ws_path.mkdir(parents=True, exist_ok=True)
        return ws_path

    def get_workspace(self, task_id: str) -> Path:
        return self.base_dir / f"task_{task_id}"

    def clean_workspace(self, task_id: str):
        ws_path = self.get_workspace(task_id)
        if ws_path.exists():
            shutil.rmtree(ws_path, ignore_errors=True)
