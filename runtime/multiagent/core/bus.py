import asyncio
from typing import Dict, List, Callable, Any
from dataclasses import dataclass, field
import datetime

@dataclass
class AgentMessage:
    sender: str
    recipient: str
    topic: str
    content: Any
    timestamp: str = field(default_factory=lambda: datetime.datetime.now(datetime.timezone.utc).isoformat())

class AgentEventBus:
    """
    Asynchronous event and communication bus for multi-agent collaboration.
    Supports 1-to-1 direct messaging, broadcast events, and audit logging.
    """
    def __init__(self):
        self._subscribers: Dict[str, List[Callable[[AgentMessage], Any]]] = {}
        self.message_history: List[AgentMessage] = []
        self._lock = asyncio.Lock()

    def subscribe(self, topic: str, callback: Callable[[AgentMessage], Any]):
        if topic not in self._subscribers:
            self._subscribers[topic] = []
        self._subscribers[topic].append(callback)

    async def publish(self, sender: str, recipient: str, topic: str, content: Any) -> AgentMessage:
        msg = AgentMessage(sender=sender, recipient=recipient, topic=topic, content=content)
        async with self._lock:
            self.message_history.append(msg)

        handlers = self._subscribers.get(topic, []) + self._subscribers.get("*", [])
        for handler in handlers:
            if asyncio.iscoroutinefunction(handler):
                asyncio.create_task(handler(msg))
            else:
                handler(msg)
        return msg

    def get_messages_for_agent(self, agent_name: str) -> List[AgentMessage]:
        return [m for m in self.message_history if m.sender == agent_name or m.recipient in (agent_name, "*")]
