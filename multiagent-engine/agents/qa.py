from typing import Dict, Any
from pathlib import Path
from core.bus import AgentEventBus
from tools.file_tools import FileTools
from tools.exec_tools import ExecTools

class QAAgent:
    """
    QA Agent:
    - Inspects code written by Developer.
    - Generates unit test suite in workspace.
    - Executes test suite using ExecTools.
    - Validates exit code and test assertions.
    - Publishes verdict back to team.
    """
    def __init__(self, bus: AgentEventBus):
        self.name = "QA"
        self.bus = bus

    async def inspect_and_test(self, task_id: str, workspace_root: Path) -> Dict[str, Any]:
        file_tools = FileTools(workspace_root)
        exec_tools = ExecTools(workspace_root)

        await self.bus.publish(
            sender=self.name,
            recipient="*",
            topic="qa:started",
            content={"task_id": task_id}
        )

        code_content = file_tools.read_file("service.py")
        if "def process_item" not in code_content or "def sanitize_id" not in code_content:
            verdict = {"task_id": task_id, "verdict": "FAIL", "reason": "Missing required service functions"}
            await self.bus.publish(self.name, "Architect", "qa:verdict", verdict)
            return verdict

        test_code = '''import unittest
from service import process_item, calculate_total, sanitize_id

class TestService(unittest.TestCase):
    def test_process_valid(self):
        res = process_item("SKU-1", 100.0)
        self.assertEqual(res["status"], "PROCESSED")
        self.assertEqual(res["value"], 100.0)

    def test_negative_value_raises(self):
        with self.assertRaises(ValueError):
            process_item("SKU-2", -5.0)

    def test_total_calculation(self):
        items = [{"value": 10.0}, {"value": 20.5}]
        self.assertEqual(calculate_total(items), 30.5)

    def test_sanitize_id(self):
        self.assertEqual(sanitize_id("  ABC-123  "), "abc-123")

if __name__ == "__main__":
    unittest.main()
'''
        file_tools.write_file("test_service.py", test_code)

        test_run = exec_tools.run_tests("test_service.py")

        passed = test_run["success"]
        verdict = {
            "task_id": task_id,
            "verdict": "PASS" if passed else "FAIL",
            "test_output": test_run["stderr"] or test_run["stdout"],
            "exit_code": test_run["exit_code"]
        }

        await self.bus.publish(
            sender=self.name,
            recipient="Architect",
            topic="qa:verdict",
            content=verdict
        )

        return verdict
