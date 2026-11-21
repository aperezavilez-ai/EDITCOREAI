from typing import Dict, Any, Optional
from pathlib import Path
from core.bus import AgentEventBus
from tools.file_tools import FileTools

class DeveloperAgent:
    """
    Developer Agent:
    - Receives specifications from Architect.
    - Generates dynamic source code using ModelRouter.
    - Creates and modifies real files in the isolated workspace.
    - Uses EditCoreAI FileTools.
    - Signals completion to QA and Security.
    """
    def __init__(self, bus: AgentEventBus, router: Optional[Any] = None):
        self.name = "Developer"
        self.bus = bus
        self.router = router

    async def execute_task(self, task_id: str, workspace_root: Path, instructions: Dict[str, Any]) -> Dict[str, Any]:
        file_tools = FileTools(workspace_root)

        await self.bus.publish(
            sender=self.name,
            recipient="Architect",
            topic="task:in_progress",
            content={"task_id": task_id, "status": "coding"}
        )

        code_generated = None
        if self.router:
            spec = instructions.get("instructions", "Implement core logic")
            prompt = f"Implementa en Python el archivo service.py para: {spec}. Genera únicamente código Python válido con funciones procesadoras y sanitizadoras. Sin markdown."
            llm_code = await self.router.complete_prompt("developer", "Eres un Desarrollador Senior de EditCoreAI. Generas código Python impecable.", prompt)
            if llm_code and "def " in llm_code:
                # Strip markdown code blocks if any
                clean_code = llm_code.replace("```python", "").replace("```", "").strip()
                code_generated = clean_code

        if not code_generated:
            code_generated = '''def process_item(item_id: str, value: float) -> dict:
    if value < 0:
        raise ValueError("Item value cannot be negative")
    return {"id": item_id, "value": value, "status": "PROCESSED"}

def calculate_total(items: list) -> float:
    return sum(item.get("value", 0.0) for item in items)

def sanitize_id(raw_id: str) -> str:
    return raw_id.strip().lower()
'''

        file_tools.write_file("service.py", code_generated)

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
