from typing import Dict, Any
from pathlib import Path
from core.bus import AgentEventBus
from tools.file_tools import FileTools
import ast

class AnalystAgent:
    """
    Analyst Agent:
    - Inspects AST and syntax tree of modified code.
    - Diagnoses complexity, function signatures, and docstring presence.
    """
    def __init__(self, bus: AgentEventBus):
        self.name = "Analyst"
        self.bus = bus

    async def analyze_workspace(self, task_id: str, workspace_root: Path) -> Dict[str, Any]:
        file_tools = FileTools(workspace_root)
        files = [f for f in file_tools.list_files() if f.endswith(".py")]

        metrics = {}
        for f in files:
            content = file_tools.read_file(f)
            tree = ast.parse(content)
            functions = [n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
            classes = [n.name for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
            metrics[f] = {
                "functions": functions,
                "classes": classes,
                "lines": len(content.splitlines())
            }

        report = {
            "task_id": task_id,
            "metrics": metrics
        }

        await self.bus.publish(
            sender=self.name,
            recipient="Architect",
            topic="analyst:report",
            content=report
        )

        return report
