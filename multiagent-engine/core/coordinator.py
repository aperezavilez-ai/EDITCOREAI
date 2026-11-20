import asyncio
import time
from typing import Dict, Any, Optional, List
from pathlib import Path

from core.bus import AgentEventBus
from core.storage import TaskStorage
from core.workspace import WorkspaceManager
from core.registry import AgentRegistry
from core.router import ModelRouter

from agents.architect import ArchitectAgent
from agents.developer import DeveloperAgent
from agents.qa import QAAgent
from agents.security import SecurityAgent
from agents.analyst import AnalystAgent

class MultiAgentCoordinator:
    """
    Main Multi-Agent Coordinator for EditCore AI.
    - Manages non-blocking concurrent task execution.
    - Persists checkpoints in SQLite.
    - Confines errors per task worker without crashing.
    - Integrates with ModelRouter and AgentRegistry.
    """
    def __init__(self, base_dir: Path, db_name: str = "tasks.db"):
        self.base_dir = Path(base_dir)
        self.workspace_mgr = WorkspaceManager(self.base_dir / "workspaces")
        self.storage = TaskStorage(str(self.base_dir / db_name))
        self.bus = AgentEventBus()
        self.registry = AgentRegistry()
        self.router = ModelRouter()

        self.architect = ArchitectAgent(self.bus)
        self.developer = DeveloperAgent(self.bus)
        self.qa = QAAgent(self.bus)
        self.security = SecurityAgent(self.bus)
        self.analyst = AnalystAgent(self.bus)

        self.task_queue: asyncio.Queue = asyncio.Queue()
        self.active_workers: Dict[str, asyncio.Task] = {}
        self.running = False
        self._worker_loop_task: Optional[asyncio.Task] = None

    async def start(self):
        self.running = True
        self._worker_loop_task = asyncio.create_task(self._process_queue())

    async def stop(self):
        self.running = False
        if self._worker_loop_task:
            self._worker_loop_task.cancel()
        for task_id, worker in list(self.active_workers.items()):
            if not worker.done():
                worker.cancel()
        await asyncio.sleep(0.05)

    async def submit_task(self, task_id: str, title: str, spec: str) -> str:
        input_data = {"spec": spec}
        self.storage.create_task(task_id, title, input_data)
        await self.task_queue.put({"task_id": task_id, "title": title, "spec": spec})
        return task_id

    async def _process_queue(self):
        while self.running:
            try:
                task_data = await asyncio.wait_for(self.task_queue.get(), timeout=0.2)
                task_id = task_data["task_id"]
                worker_task = asyncio.create_task(self._execute_task_pipeline(task_data))
                self.active_workers[task_id] = worker_task
                self.task_queue.task_done()
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

    async def _execute_task_pipeline(self, task_data: Dict[str, Any]):
        task_id = task_data["task_id"]
        spec = task_data["spec"]
        ws = self.workspace_mgr.create_workspace(task_id)

        self.storage.update_status(task_id, "RUNNING")

        try:
            # Checkpoint 1: Planning
            self.registry.update_agent_status("agent_architect", "WORKING")
            self.storage.add_checkpoint(task_id, "PLANNING", {"stage": "start"})
            plan = await self.architect.plan_and_delegate(task_id, spec)
            self.storage.add_checkpoint(task_id, "PLANNED", plan)
            self.registry.update_agent_status("agent_architect", "IDLE")

            # Checkpoint 2: Implementation
            self.registry.update_agent_status("agent_developer", "WORKING")
            dev_result = await self.developer.execute_task(task_id, ws, plan)
            self.storage.add_checkpoint(task_id, "CODED", dev_result)
            self.registry.update_agent_status("agent_developer", "IDLE")

            # Checkpoint 3: Code Analysis
            self.registry.update_agent_status("agent_analyst", "WORKING")
            analysis_report = await self.analyst.analyze_workspace(task_id, ws)
            self.storage.add_checkpoint(task_id, "ANALYZED", analysis_report)
            self.registry.update_agent_status("agent_analyst", "IDLE")

            # Checkpoint 4: Security Scan
            self.registry.update_agent_status("agent_security", "WORKING")
            security_report = await self.security.audit_workspace(task_id, ws)
            self.storage.add_checkpoint(task_id, "AUDITED", security_report)
            self.registry.update_agent_status("agent_security", "IDLE")

            # Checkpoint 5: Quality Assurance
            self.registry.update_agent_status("agent_qa", "WORKING")
            qa_verdict = await self.qa.inspect_and_test(task_id, ws)
            self.storage.add_checkpoint(task_id, "VALIDATED", qa_verdict)
            self.registry.update_agent_status("agent_qa", "IDLE")

            final_output = {
                "plan": plan,
                "dev_result": dev_result,
                "analysis": analysis_report,
                "security": security_report,
                "qa_verdict": qa_verdict,
                "files": list(dev_result["created_files"])
            }

            self.storage.update_status(task_id, "COMPLETED", output=final_output)

        except Exception as e:
            self.storage.update_status(task_id, "FAILED", error=str(e))
        finally:
            if task_id in self.active_workers:
                del self.active_workers[task_id]

    async def recover_pending_tasks(self) -> List[str]:
        recoverable = self.storage.list_recoverable_tasks()
        recovered_ids = []
        for t in recoverable:
            tid = t["task_id"]
            spec = t["input_data"].get("spec", "")
            await self.task_queue.put({"task_id": tid, "title": t["title"], "spec": spec})
            recovered_ids.append(tid)
        return recovered_ids
