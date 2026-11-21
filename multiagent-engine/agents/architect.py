from typing import Dict, Any, List, Optional
from core.bus import AgentEventBus

class ArchitectAgent:
    """
    Architect Agent:
    - Analyzes incoming requirements dynamically using ModelRouter.
    - Designs modular file structure and technical specifications.
    - Decomposes work into subtasks for Developer and QA agents.
    - Communicates and delegates via the AgentEventBus.
    """
    def __init__(self, bus: AgentEventBus, router: Optional[Any] = None):
        self.name = "Architect"
        self.bus = bus
        self.router = router

    async def plan_and_delegate(self, task_id: str, specification: str) -> Dict[str, Any]:
        await self.bus.publish(
            sender=self.name,
            recipient="*",
            topic="planning:start",
            content={"task_id": task_id, "spec": specification}
        )

        plan = None
        if self.router:
            prompt = f"Diseña la arquitectura para la tarea: {specification}. Retorna una descripción concisa de los componentes."
            llm_res = await self.router.complete_prompt("architect", "Eres el Arquitecto de Software de EditCoreAI. Diseña soluciones técnicas.", prompt)
            if llm_res and len(llm_res.strip()) > 10:
                plan = {
                    "task_id": task_id,
                    "architecture": llm_res.strip()[:300],
                    "components": [
                        {
                            "name": "core_logic",
                            "file": "service.py",
                            "description": "Lógica principal y manejo de errores"
                        },
                        {
                            "name": "test_suite",
                            "file": "test_service.py",
                            "description": "Pruebas unitarias automatizadas"
                        }
                    ]
                }

        if not plan:
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
