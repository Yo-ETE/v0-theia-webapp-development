"""
THEIA - Server-Sent Events broadcast manager
"""
import asyncio
import json
from typing import Any


class SSEManager:
    """Simple broadcast SSE manager for real-time events."""

    def __init__(self):
        self._clients: list[asyncio.Queue] = []

    async def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._clients.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue):
        if queue in self._clients:
            self._clients.remove(queue)

    async def broadcast(self, event_type: str, data: Any):
        payload = json.dumps({"type": event_type, "data": data})
        dead: list[asyncio.Queue] = []
        for q in self._clients:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._clients.remove(q)

    @property
    def client_count(self) -> int:
        return len(self._clients)


sse_manager = SSEManager()
