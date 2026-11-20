import subprocess
import sys
from pathlib import Path
from typing import Dict, Any

class ExecTools:
    """
    OpenHands-inspired execution tools running strictly inside workspace.
    """
    def __init__(self, workspace_root: Path):
        self.workspace_root = Path(workspace_root)

    def run_command(self, cmd: str, timeout_sec: int = 30) -> Dict[str, Any]:
        try:
            res = subprocess.run(
                cmd,
                shell=True,
                cwd=str(self.workspace_root),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout_sec
            )
            return {
                "exit_code": res.returncode,
                "stdout": res.stdout,
                "stderr": res.stderr,
                "success": res.returncode == 0
            }
        except subprocess.TimeoutExpired:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Command timed out after {timeout_sec} seconds",
                "success": False
            }
        except Exception as e:
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": str(e),
                "success": False
            }

    def run_tests(self, test_file: str) -> Dict[str, Any]:
        cmd = f'"{sys.executable}" "{test_file}"'
        return self.run_command(cmd)
