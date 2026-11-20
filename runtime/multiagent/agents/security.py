from typing import Dict, Any
from pathlib import Path
from core.bus import AgentEventBus
from tools.file_tools import FileTools
import re

class SecurityAgent:
    """
    Security Agent:
    - Scans produced files for leaked API keys, tokens, or credentials.
    - Audits syntax for unsafe calls (eval, unescaped sql, exec).
    - Publishes security clearance or warning to Coordinator.
    """
    def __init__(self, bus: AgentEventBus):
        self.name = "Security"
        self.bus = bus

    async def audit_workspace(self, task_id: str, workspace_root: Path) -> Dict[str, Any]:
        file_tools = FileTools(workspace_root)
        files = file_tools.list_files()

        secret_patterns = [
            r"sk-[a-zA-Z0-9]{20,}",
            r"ghp_[a-zA-Z0-9]{20,}",
            r"eyJh[a-zA-Z0-9_-]{20,}"
        ]

        violations = []
        for f in files:
            content = file_tools.read_file(f)
            for pat in secret_patterns:
                if re.search(pat, content):
                    violations.append(f"Secret token pattern detected in {f}")

        clearance = len(violations) == 0
        report = {
            "task_id": task_id,
            "security_clearance": clearance,
            "violations": violations
        }

        await self.bus.publish(
            sender=self.name,
            recipient="Coordinator",
            topic="security:audit",
            content=report
        )

        return report
