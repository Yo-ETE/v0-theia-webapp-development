"""
THEIA - SSE stream endpoint
"""
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from backend.sse import sse_manager

router = APIRouter(tags=["stream"])


@router.get("/stream")
async def stream():
    queue = await sse_manager.subscribe()

    async def event_generator():
        try:
            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {data}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            sse_manager.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
