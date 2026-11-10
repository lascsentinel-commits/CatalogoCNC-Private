import os
import subprocess
import base64
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import HTMLResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.indexer import (
    scan_all_designs,
    load_ignored,
    save_ignored,
    load_ignored_folders,
    save_ignored_folders,
    CACHE_DIR,
    CAPTURES_DIR,
    BASE_DIR
)
from app.gcode_parser import generate_toolpath_svg

app = FastAPI(title="Catálogo CNC · Ámbar del Sur & Guissel", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

UGS_BIN = "/home/dhamit/Descargas/ugsplatform-linux-x64/bin/ugsplatform"

@app.get("/", response_class=HTMLResponse)
async def get_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        with open(index_file, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Catálogo CNC cargando...</h1>"

@app.get("/api/collections")
async def get_collections(
    search: Optional[str] = None,
    filter_type: str = "active" # active, ignored, all
):
    collections = scan_all_designs(force_refresh=False)
    ignored_folders = load_ignored_folders()
    ignored_designs = load_ignored()
    
    result = []
    total_folders = 0
    total_designs = 0
    
    q = search.lower().strip() if search else None

    for col in collections:
        col_copy = {
            "id": col["id"],
            "title": col["title"],
            "subtitle": col["subtitle"],
            "badge": col["badge"],
            "folders": []
        }
        
        for folder in col["folders"]:
            fid = folder["folder_id"]
            is_folder_ign = fid in ignored_folders
            
            # Filtrar carpetas según estado de descarte
            if filter_type == "active" and is_folder_ign:
                continue
            elif filter_type == "ignored" and not is_folder_ign:
                continue

            folder_copy = {
                "folder_id": fid,
                "name": folder["name"],
                "collection": folder["collection"],
                "designs_count": folder["designs_count"],
                "total_files": folder["total_files"],
                "is_ignored": is_folder_ign,
                "designs": []
            }
            
            # Filtrar diseños de adentro
            for des in folder["designs"]:
                did = des["id"]
                is_des_ign = is_folder_ign or (did in ignored_designs)
                des["is_ignored"] = is_des_ign
                
                if filter_type == "active" and is_des_ign:
                    continue
                elif filter_type == "ignored" and not is_des_ign:
                    continue
                    
                if q:
                    m_name = q in des["name"].lower()
                    m_cat = q in des["category"].lower()
                    m_file = any(q in f["name"].lower() for f in des["files"])
                    if not (m_name or m_cat or m_file):
                        continue
                        
                folder_copy["designs"].append(des)
                
            # Si hay búsqueda y no coincide ningún diseño ni el nombre de carpeta, omitir
            if q and not folder_copy["designs"] and q not in folder_copy["name"].lower():
                continue
                
            folder_copy["designs_count"] = len(folder_copy["designs"])
            col_copy["folders"].append(folder_copy)
            total_folders += 1
            total_designs += folder_copy["designs_count"]
            
        col_copy["folders_count"] = len(col_copy["folders"])
        col_copy["total_designs"] = sum(f["designs_count"] for f in col_copy["folders"])
        result.append(col_copy)

    return {
        "collections": result,
        "total_folders": total_folders,
        "total_designs": total_designs,
        "ignored_folders_count": len(ignored_folders),
        "ignored_designs_count": len(ignored_designs)
    }

class ToggleFolderIgnoreRequest(BaseModel):
    folder_id: str

@app.post("/api/toggle-folder-ignore")
async def toggle_folder_ignore(req: ToggleFolderIgnoreRequest):
    """Descarta o restaura una carpeta completa del catálogo (sin tocar el computador)"""
    ignored = load_ignored_folders()
    if req.folder_id in ignored:
        ignored.remove(req.folder_id)
        state = False
    else:
        ignored.add(req.folder_id)
        state = True
    save_ignored_folders(ignored)
    scan_all_designs(force_refresh=True)
    return {"success": True, "is_ignored": state}

class ToggleDesignIgnoreRequest(BaseModel):
    design_id: str

@app.post("/api/toggle-design-ignore")
async def toggle_design_ignore(req: ToggleDesignIgnoreRequest):
    """Descarta o restaura un diseño individual del catálogo"""
    ignored = load_ignored()
    if req.design_id in ignored:
        ignored.remove(req.design_id)
        state = False
    else:
        ignored.add(req.design_id)
        state = True
    save_ignored(ignored)
    scan_all_designs(force_refresh=True)
    return {"success": True, "is_ignored": state}

@app.get("/api/preview-svg")
async def get_preview_svg(path: str):
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
        
    cache_key = f"{p.stem}_{p.stat().st_size}.svg"
    cached_file = CACHE_DIR / cache_key
    if cached_file.exists():
        with open(cached_file, "r", encoding="utf-8") as f:
            return Response(content=f.read(), media_type="image/svg+xml")
            
    svg_code, w, h = generate_toolpath_svg(str(p))
    if not svg_code:
        raise HTTPException(status_code=400, detail="No se pudo procesar el G-code")
        
    with open(cached_file, "w", encoding="utf-8") as f:
        f.write(svg_code)
        
    return Response(content=svg_code, media_type="image/svg+xml")

@app.get("/api/image")
async def get_image(path: str):
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Imagen no encontrada")
    return FileResponse(str(p))

class OpenUGSRequest(BaseModel):
    file_path: str

@app.post("/api/open-ugs")
async def open_in_ugs(req: OpenUGSRequest):
    p = Path(req.file_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
        
    try:
        if os.name == "nt":
            # En Windows abre el archivo con UGS o programa predeterminado
            os.startfile(str(p))
            return {"success": True, "message": f"Abriendo archivo en Windows: {p.name}"}
        else:
            env = os.environ.copy()
            env["DISPLAY"] = ":0"
            env["XAUTHORITY"] = "/home/dhamit/.Xauthority"
            cmd = [UGS_BIN, "--open", str(p)]
            subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return {"success": True, "message": f"Abriendo en UGS: {p.name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error abriendo UGS: {str(e)}")

class OpenFolderRequest(BaseModel):
    folder_path: str

@app.post("/api/open-folder")
async def open_folder(req: OpenFolderRequest):
    p = Path(req.folder_path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")
        
    try:
        if os.name == "nt":
            os.startfile(str(p))
            return {"success": True, "message": f"Carpeta abierta: {p.name}"}
        else:
            env = os.environ.copy()
            env["DISPLAY"] = ":0"
            env["XAUTHORITY"] = "/home/dhamit/.Xauthority"
            subprocess.Popen(["thunar", str(p)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return {"success": True, "message": f"Carpeta abierta: {p.name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class UploadCaptureBase64(BaseModel):
    design_id: str
    file_id: Optional[str] = None
    image_base64: str

@app.post("/api/save-clipboard-capture")
async def save_clipboard_capture(req: UploadCaptureBase64):
    data = req.image_base64
    if "," in data:
        data = data.split(",", 1)[1]
    
    try:
        img_bytes = base64.b64decode(data)
        out_path = CAPTURES_DIR / f"{req.design_id}.png"
        with open(out_path, "wb") as f:
            f.write(img_bytes)

        # Si se seleccionó una variante o archivo de corte específico, guardarla también para ese archivo
        if req.file_id:
            var_path = CAPTURES_DIR / f"{req.file_id}.png"
            with open(var_path, "wb") as f:
                f.write(img_bytes)
            
        scan_all_designs(force_refresh=True)
        return {"success": True, "photo_path": str(out_path)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error guardando imagen: {str(e)}")

class TriggerScreenshotRequest(BaseModel):
    design_id: str
    file_id: Optional[str] = None

@app.post("/api/trigger-screenshot")
async def trigger_screenshot(req: TriggerScreenshotRequest):
    out_path = CAPTURES_DIR / f"{req.design_id}.png"
    env = os.environ.copy()
    env["DISPLAY"] = ":0"
    env["XAUTHORITY"] = "/home/dhamit/.Xauthority"
    
    try:
        proc = subprocess.Popen(
            ["xfce4-screenshooter", "-r", "-s", str(out_path)],
            env=env
        )
        proc.wait(timeout=30)
        
        if out_path.exists() and out_path.stat().st_size > 500:
            if req.file_id:
                var_path = CAPTURES_DIR / f"{req.file_id}.png"
                with open(out_path, "rb") as src, open(var_path, "wb") as dst:
                    dst.write(src.read())
            scan_all_designs(force_refresh=True)
            return {"success": True, "photo_path": str(out_path)}
        else:
            return {"success": False, "message": "Captura cancelada o vacía"}
    except subprocess.TimeoutExpired:
        proc.kill()
        return {"success": False, "message": "Tiempo agotado para la captura"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/refresh-index")
async def refresh_index():
    scan_all_designs(force_refresh=True)
    return {"success": True, "message": "Catálogo actualizado"}

@app.get("/api/download-zip")
async def download_zip():
    """Genera y descarga el paquete completo listo para Windows"""
    import zipfile
    import io
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for folder_name in ["app", "static", "captures"]:
            folder_path = BASE_DIR / folder_name
            if folder_path.exists():
                for root, _, files in os.walk(folder_path):
                    if "__pycache__" in root or ".backups" in root:
                        continue
                    for file in files:
                        if not file.endswith((".pyc", ".tmp")):
                            full_path = Path(root) / file
                            rel_path = full_path.relative_to(BASE_DIR)
                            zip_file.write(full_path, rel_path)
    zip_buffer.seek(0)
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=CatalogoCNC-Windows.zip"}
    )
