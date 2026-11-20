from typing import Dict, Any, List
from core.bus import AgentEventBus

class ArchitectAgent:
    """
    Architect Agent:
    - Analyzes incoming requirements.
    - Designs modular file structure and technical specifications.
    - Decomposes work into subtasks for Developer and QA agents.
    - Communicates and delegates via the AgentEventBus.
    """
    def __init__(self, bus: AgentEventBus):
        self.name = "Architect"
        self.bus = bus

    async def plan_and_delegate(self, task_id: str, specification: str) -> Dict[str, Any]:
        await self.bus.publish(
            sender=self.name,
            recipient="*",
            topic="planning:start",
            content={"task_id": task_id, "spec": specification}
        )

        plan = {
            "task_id": task_id,
            "architecture": f"EditCoreAI MultiAgent Architecture: {specification[:50]}",
            "components": [
                {
                    "name": "core_logic",
                    "file": "service.py",
                    "description": "Implements core business logic and error handling"
                },
                {
                    "name": "test_suite",
                    "file": "test_service.py",
                    "description": "Automated unit tests covering validation and edge cases"
                }
            ]
        }

        await self.bus.publish(
            sender=self.name,
            recipient="Developer",
            topic="task:delegate",
            content={
                "task_id": task_id,
                "role": "developer",
                "instructions": "Implement service.py per specification",
                "components": plan["components"]
            }
        )

        return plan
