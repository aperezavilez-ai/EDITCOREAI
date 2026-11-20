import argparse
import asyncio
import os
import sys
import psutil
from pathlib import Path
from typing import Dict, Any, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from core.coordinator import MultiAgentCoordinator

# Parse arguments for host, port, token, data-dir
parser = argparse.ArgumentParser(description="EditCore AI MultiAgent Sidecar")
parser.add_argument("--host", default="127.0.0.1", help="Host address")
parser.add_argument("--port", type=int, default=55410, help="Port to bind")
parser.add_argument("--token", default="", help="Auth token for IPC")
parser.add_argument("--data-dir", default=str(BASE_DIR / "data"), help="Storage directory")

# Allow running via uvicorn directly or CLI
if __name__ == "__main__":
    args = parser.parse_args()
else:
    # Defaults when imported or spawned
    args = argparse.Namespace(host="127.0.0.1", port=55410, token=os.environ.get("EDITCORE_AGENT_TOKEN", ""), data_dir=str(BASE_DIR / "data"))

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await coordinator.start()
    yield
    await coordinator.stop()

app = FastAPI(title="EditCore MultiAgent Engine", version="1.0.0", lifespan=lifespan)
coordinator = MultiAgentCoordinator(Path(args.data_dir), db_name="multiagent.db")

AUTH_TOKEN = args.token or os.environ.get("EDITCORE_AGENT_TOKEN", "")

def verify_token(x_editcore_token: Optional[str] = Header(None)):
    if AUTH_TOKEN and x_editcore_token != AUTH_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

class TaskCreateRequest(BaseModel):
    task_id: str
    title: str
    spec: str

@app.get("/health")
async def health_check():
    process = psutil.Process(os.getpid())
    return {
        "status": "healthy",
        "engine": "Agno + OpenHands Core",
        "version": "1.0.0",
        "active_workers": len(coordinator.active_workers),
        "queue_size": coordinator.task_queue.qsize(),
        "memory_mb": round(process.memory_info().rss / (1024 * 1024), 2)
    }

@app.get("/api/agents", dependencies=[Depends(verify_token)])
async def list_agents():
    return {"agents": coordinator.registry.list_agents()}

@app.post("/api/tasks", dependencies=[Depends(verify_token)])
async def create_task(req: TaskCreateRequest):
    await coordinator.submit_task(req.task_id, req.title, req.spec)
    return {"task_id": req.task_id, "status": "QUEUED"}

@app.get("/api/tasks", dependencies=[Depends(verify_token)])
async def list_tasks(limit: int = 50):
    tasks = coordinator.storage.list_all_tasks(limit=limit)
    return {"tasks": tasks}

@app.get("/api/tasks/{task_id}", dependencies=[Depends(verify_token)])
async def get_task_status(task_id: str):
    task = coordinator.storage.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@app.get("/api/tasks/{task_id}/messages", dependencies=[Depends(verify_token)])
async def get_task_messages(task_id: str):
    msgs = [
        {"sender": m.sender, "recipient": m.recipient, "topic": m.topic, "content": m.content, "timestamp": m.timestamp}
        for m in coordinator.bus.message_history
        if isinstance(m.content, dict) and m.content.get("task_id") == task_id
    ]
    return {"task_id": task_id, "messages": msgs}

@app.post("/api/tasks/{task_id}/cancel", dependencies=[Depends(verify_token)])
async def cancel_task(task_id: str):
    if task_id in coordinator.active_workers:
        coordinator.active_workers[task_id].cancel()
        coordinator.storage.update_status(task_id, "CANCELLED")
        return {"task_id": task_id, "status": "CANCELLED"}
    return {"task_id": task_id, "status": "NOT_RUNNING"}

from tools.editcore_bridge import EditCoreBridge
bridge = EditCoreBridge()

@app.get("/api/editcore/tools", dependencies=[Depends(verify_token)])
async def get_editcore_tools():
    return {"tools": bridge.get_available_tools()}

@app.post("/api/editcore/tools/execute", dependencies=[Depends(verify_token)])
async def execute_editcore_tool(req: Dict[str, Any]):
    tool_name = req.get("tool")
    tool_args = req.get("args", {})
    return bridge.execute_tool(tool_name, tool_args)

@app.get("/api/editcore/skills", dependencies=[Depends(verify_token)])
async def get_editcore_skills():
    return {"skills": bridge.list_skills()}

@app.get("/api/editcore/skills/{slug}", dependencies=[Depends(verify_token)])
async def get_editcore_skill_content(slug: str):
    content = bridge.get_skill(slug)
    return {"slug": slug, "content": content}

if __name__ == "__main__":
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
