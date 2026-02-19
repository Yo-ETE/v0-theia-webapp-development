"""
THEIA - Offline map tile server
Serves pre-downloaded OSM tiles from local storage.
"""
import os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/tiles", tags=["tiles"])

MAP_TILE_DIR = os.getenv("MAP_TILE_DIR", "/opt/theia/tiles")


@router.get("/{z}/{x}/{y}.png")
async def get_tile(z: int, x: int, y: int):
    tile_path = Path(MAP_TILE_DIR) / str(z) / str(x) / f"{y}.png"
    if not tile_path.exists():
        raise HTTPException(status_code=404, detail="Tile not found")
    return FileResponse(
        str(tile_path),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )
