from typing import Dict, Any
from pathlib import Path
from core.bus import AgentEventBus
from tools.file_tools import FileTools

class DeveloperAgent:
    """
    Developer Agent:
    - Receives specifications from Architect.
    - Creates and modifies real files in the isolated workspace.
    - Uses OpenHands-style FileTools.
    - Signals completion to QA and Security.
    """
    def __init__(self, bus: AgentEventBus):
        self.name = "Developer"
        self.bus = bus

    async def execute_task(self, task_id: str, workspace_root: Path, instructions: Dict[str, Any]) -> Dict[str, Any]:
        file_tools = FileTools(workspace_root)

        await self.bus.publish(
            sender=self.name,
            recipient="Architect",
            topic="task:in_progress",
            content={"task_id": task_id, "status": "coding"}
        )

        service_code = '''def process_item(item_id: str, value: float) -> dict:
    if value < 0:
        raise ValueError("Item value cannot be negative")
    return {"id": item_id, "value": value, "status": "PROCESSED"}

def calculate_total(items: list) -> float:
    return sum(item.get("value", 0.0) for item in items)
'''
        file_tools.write_file("service.py", service_code)

        # Mutate file to add validation helper
        file_tools.edit_file(
            "service.py",
            "def calculate_total(items: list) -> float:\n    return sum(item.get(\"value\", 0.0) for item in items)",
            "def calculate_total(items: list) -> float:\n    return sum(item.get(\"value\", 0.0) for item in items)\n\ndef sanitize_id(raw_id: str) -> str:\n    return raw_id.strip().lower()"
        )

        created_files = file_tools.list_files()

        result = {
            "task_id": task_id,
            "created_files": created_files,
            "status": "code_ready"
        }

        await self.bus.publish(
            sender=self.name,
            recipient="QA",
            topic="qa:request",
            content=result
        )

        return result
