import os
import urllib.request
import urllib.parse
import json
from typing import Dict, Any, List, Optional

class EditCoreBridge:
    """
    Python client bridging agents to EditCore AI's 74 native tools and 100+ skills.
    Communicates via authenticated local HTTP gateway.
    """
    def __init__(self, gateway_url: Optional[str] = None, token: Optional[str] = None):
        self.gateway_url = gateway_url or os.environ.get("EDITCORE_GATEWAY_URL", "http://127.0.0.1:55430")
        self.token = token or os.environ.get("EDITCORE_AGENT_TOKEN", "")

    def _request(self, path: str, method: str = "GET", body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.gateway_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["X-EditCore-Token"] = self.token

        data = json.dumps(body).encode("utf-8") if body else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                res_data = res.read().decode("utf-8")
                return json.loads(res_data)
        except Exception as e:
            return {"ok": False, "error": f"Bridge request failed ({method} {path}): {str(e)}"}

    def get_available_tools(self) -> List[Dict[str, Any]]:
        """List all 74 tools available in EditCore AI."""
        res = self._request("/api/tools")
        return res.get("tools", [])

    def execute_tool(self, tool_name: str, args: Optional[Dict[str, Any]] = None, project_root: Optional[str] = None) -> Dict[str, Any]:
        """
        Execute any of EditCore AI's 74 tools:
        e.g. 'git_status', 'git_commit', 'web_search', 'read_roadmap', 'supabase_migrate', etc.
        """
        payload = {
            "tool": tool_name,
            "args": args or {},
            "projectRoot": project_root
        }
        res = self._request("/api/tools/execute", method="POST", body=payload)
        return res

    def list_skills(self) -> List[Dict[str, Any]]:
        """List all skills installed in EditCore AI."""
        res = self._request("/api/skills")
        return res.get("skills", [])

    def get_skill(self, slug: str) -> Optional[str]:
        """Load full instructions for an installed skill."""
        res = self._request(f"/api/skills/{slug}")
        return res.get("content")
