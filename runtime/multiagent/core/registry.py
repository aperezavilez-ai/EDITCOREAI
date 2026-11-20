from typing import Dict, Any, List, Optional

class AgentDescriptor:
    def __init__(self, agent_id: str, name: str, role: str, description: str, tools: List[str]):
        self.agent_id = agent_id
        self.name = name
        self.role = role
        self.description = description
        self.tools = tools
        self.status = "IDLE"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "name": self.name,
            "role": self.role,
            "description": self.description,
            "tools": self.tools,
            "status": self.status
        }

class AgentRegistry:
    """
    Registry of specialized autonomous agents in EditCore AI.
    Permits both core specialized agents and dynamically created agents.
    """
    def __init__(self):
        self._agents: Dict[str, AgentDescriptor] = {}
        self._register_defaults()

    def _register_defaults(self):
        defaults = [
            AgentDescriptor("agent_architect", "Architect", "Planning & Architecture", "High-level design, task decomposition, and structural planning", ["plan_and_delegate"]),
            AgentDescriptor("agent_developer", "Developer", "Code Implementation", "Writes, modifies, and patches source files in isolated workspaces", ["write_file", "edit_file", "read_file"]),
            AgentDescriptor("agent_qa", "QA", "Quality Assurance & Testing", "Inspects code, executes unit tests, and verifies assertions", ["read_file", "run_tests"]),
            AgentDescriptor("agent_security", "Security", "Security & Vulnerability Audit", "Audits secrets, OWASP vulnerabilities, and permission boundaries", ["scan_secrets", "audit_syntax"]),
            AgentDescriptor("agent_analyst", "Analyst", "Code Inspection & Diagnostics", "Analyzes call trees, stack traces, and bug root causes", ["inspect_ast", "grep_search"]),
            AgentDescriptor("agent_optimizer", "Optimizer", "Performance & Optimization", "Identifies bottlenecks, memory leaks, and algorithmic inefficiencies", ["profile_execution"]),
            AgentDescriptor("agent_research", "Researcher", "Technical Research", "Gathers technical docs, library specs, and ecosystem APIs", ["web_search", "read_docs"]),
            AgentDescriptor("agent_documentation", "Documentation", "Docs & Audit Logs", "Produces release notes, API docs, and operation audit logs", ["generate_markdown"])
        ]
        for ag in defaults:
            self._agents[ag.agent_id] = ag

    def get_agent(self, agent_id: str) -> Optional[AgentDescriptor]:
        return self._agents.get(agent_id)

    def list_agents(self) -> List[Dict[str, Any]]:
        return [ag.to_dict() for ag in self._agents.values()]

    def update_agent_status(self, agent_id: str, status: str):
        if agent_id in self._agents:
            self._agents[agent_id].status = status
