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
        self.nexus_url = os.environ.get("EDITCORE_NEXUS_URL", "http://127.0.0.1:11435")

    def get_preferred_provider(self, role: str) -> str:
        """Select best available provider for specific agent specialty."""
        if os.environ.get("USE_NEXUS_LOCAL") == "1":
            return "editcore_nexus"
        if self.anthropic_key:
            return "anthropic"
        if self.openai_key:
            return "openai"
        if self.openrouter_key:
            return "openrouter"
        return "editcore_nexus"

    def get_model_name(self, provider: str, role: str) -> str:
        if provider == "editcore_nexus":
            return "editcore-nexus-v4"
        elif provider == "anthropic":
            if role in ("architect", "analyst"):
                return "claude-3-7-sonnet-20250219"
            return "claude-3-5-haiku-20241022"
        elif provider == "openai":
            return "gpt-4o"
        return "default"

    async def complete_prompt(self, role: str, system_prompt: str, user_prompt: str) -> Optional[str]:
        """
        Executes a real LLM prompt using configured credentials or EditCore Nexus v4.
        Returns the text completion or None if no keys/server or call fails.
        """
        import urllib.request
        import json

        provider = self.get_preferred_provider(role)
        model = self.get_model_name(provider, role)

        try:
            if provider == "editcore_nexus":
                # EditCore Nexus v4 local endpoint (Ollama / OpenAI compatible)
                url = f"{self.nexus_url}/api/chat"
                headers = {"Content-Type": "application/json"}
                body = {
                    "model": "editcore-nexus-v4",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "stream": False
                }
                req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    return data.get("message", {}).get("content", "") or data.get("response", "")
            if provider == "anthropic" and self.anthropic_key:
                url = "https://api.anthropic.com/v1/messages"
                headers = {
                    "x-api-key": self.anthropic_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                }
                body = {
                    "model": model,
                    "max_tokens": 2048,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_prompt}]
                }
                req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    blocks = data.get("content", [])
                    texts = [b.get("text", "") for b in blocks if b.get("type") == "text"]
                    return "".join(texts)

            elif provider == "openai" and self.openai_key:
                url = "https://api.openai.com/v1/chat/completions"
                headers = {
                    "Authorization": f"Bearer {self.openai_key}",
                    "Content-Type": "application/json"
                }
                body = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ]
                }
                req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    return data.get("choices", [{}])[0].get("message", {}).get("content", "")

        except Exception as e:
            # Fallback will handle failure
            pass

        return None
