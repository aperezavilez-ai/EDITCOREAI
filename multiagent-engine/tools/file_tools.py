import os
from pathlib import Path
from typing import List, Dict, Any

class FileTools:
    """
    EditCoreAI file tools operating within an isolated task workspace.
    """
    def __init__(self, workspace_root: Path):
        self.workspace_root = Path(workspace_root)

    def _resolve_safe(self, rel_path: str) -> Path:
        target = (self.workspace_root / rel_path).resolve()
        if not str(target).startswith(str(self.workspace_root.resolve())):
            raise PermissionError(f"Path traversal denied outside workspace: {rel_path}")
        return target

    def write_file(self, rel_path: str, content: str) -> str:
        target = self._resolve_safe(rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return f"Successfully wrote {len(content)} bytes to {rel_path}"

    def read_file(self, rel_path: str) -> str:
        target = self._resolve_safe(rel_path)
        if not target.exists():
            raise FileNotFoundError(f"File not found: {rel_path}")
        return target.read_text(encoding="utf-8")

    def edit_file(self, rel_path: str, old_str: str, new_str: str) -> str:
        content = self.read_file(rel_path)
        if old_str not in content:
            raise ValueError(f"Target string not found in {rel_path}")
        updated = content.replace(old_str, new_str, 1)
        self.write_file(rel_path, updated)
        return f"Successfully edited {rel_path}"

    def list_files(self) -> List[str]:
        files = []
        for p in self.workspace_root.rglob("*"):
            if p.is_file():
                files.append(str(p.relative_to(self.workspace_root)).replace("\\", "/"))
        return sorted(files)
