import os
from typing import Dict, Any, Optional

class ModelRouter:
    """
    Directs agent requests to appropriate AI providers configured in EditCore AI.
    Reuses existing credentials: ANTHROPIC_API_KEY, CLAUDE_API_KEY, CHATGPT_API_KEY, OPENAI_API_KEY.
    Provides failover and fallback support.
    """
    def __init__(self):
        self.anthropic_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("CLAUDE_API_KEY") or os.environ.get("EDITCORE_CLAUDE_PRIMARY_API_KEY")
        self.openai_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("CHATGPT_API_KEY")
        self.openrouter_key = os.environ.get("OPENROUTER_API_KEY")
        self.minimax_key = os.environ.get("MINIMAX_API_KEY")

    def get_preferred_provider(self, role: str) -> str:
        """Select best available provider for specific agent specialty."""
        if self.anthropic_key:
            return "anthropic"
        if self.openai_key:
            return "openai"
        if self.openrouter_key:
            return "openrouter"
        return "local_fallback"

    def get_model_name(self, provider: str, role: str) -> str:
        if provider == "anthropic":
            if role in ("architect", "analyst"):
                return "claude-3-7-sonnet-20250219"
            return "claude-3-5-haiku-20241022"
        elif provider == "openai":
            return "gpt-4o"
        return "default"
