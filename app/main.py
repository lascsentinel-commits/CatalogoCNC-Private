import os
import glob
import shutil
import subprocess
import base64
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException
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
    load_status_registry,
    set_design_updated_state,
    sync_photo_to_design_folder,
    sync_all_captures_to_folders,
    get_hash,
    IMAGE_EXTS,
    CACHE_DIR,
    CAPTURES_DIR,
    BASE_DIR,
)
from app.gcode_parser import generate_toolpath_svg

app = FastAPI(title="Catálogo CNC · Ámbar del Sur & Guissel", version="3.0.0")

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
INVALID_NAME_CHARS = set('/\\:*?"<>|')


def _find_design_meta(design_id: Optional[str] = None, file_id: Optional[str] = None):
    """Busca metadatos de carpeta y archivo en el índice en caché sin reescanear."""
    collections = scan_all_designs(force_refresh=False)
    for col in collections:
        for folder in col.get("folders", []):
            for des in folder.get("designs", []):
                if design_id and des.get("id") == design_id:
                    pfile = des.get("primary_file") or {}
                    return des.get("folder_path"), pfile.get("path"), des.get("photo_path")
                for var in des.get("variants", []):
                    if file_id and var.get("file_id") == file_id:
                        return var.get("folder_path"), var.get("path"), var.get("photo_path") or des.get("photo_path")
    return None, None, None


def _find_windows_ugs_exe() -> Optional[str]:
    """Busca el ejecutable de Universal Gcode Sender en Windows."""
    env_bin = os.environ.get("UGS_WIN_BIN")
    if env_bin and Path(env_bin).is_file():
        return env_bin

    cfg_file = BASE_DIR / "windows_explorer_integration" / "ugs_path.txt"
    if cfg_file.exists():
        saved = cfg_file.read_text(encoding="utf-8", errors="ignore").strip().strip('"')
        if saved and Path(saved).is_file():
            return saved

    user_prof = os.environ.get("USERPROFILE", "")
    patterns = [
        r"C:\Program Files\ugsplatform*\bin\ugsplatform64.exe",
        r"C:\Program Files\ugsplatform*\bin\ugsplatform.exe",
        r"C:\Program Files (x86)\ugsplatform*\bin\ugsplatform.exe",
        r"C:\ugsplatform*\bin\ugsplatform64.exe",
        r"C:\ugsplatform*\bin\ugsplatform.exe",
    ]
    if user_prof:
        patterns.extend([
            os.path.join(user_prof, "Downloads", "ugsplatform*", "bin", "ugsplatform64.exe"),
            os.path.join(user_prof, "Downloads", "ugsplatform*", "bin", "ugsplatform.exe"),
            os.path.join(user_prof, "Descargas", "ugsplatform*", "bin", "ugsplatform64.exe"),
            os.path.join(user_prof, "Desktop", "ugsplatform*", "bin", "ugsplatform64.exe"),
            os.path.join(user_prof, "Escritorio", "ugsplatform*", "bin", "ugsplatform64.exe"),
            os.path.join(user_prof, "AppData", "Local", "ugsplatform*", "bin", "ugsplatform64.exe"),
        ])

    for pat in patterns:
        matches = glob.glob(pat)
        if matches:
            return matches[0]
    return None


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
    filter_type: str = "active",     # active, ignored, all
    status_filter: str = "all",      # all, pending (rojos), updated (verdes)
):
    collections = scan_all_designs(force_refresh=False)
    ignored_folders = load_ignored_folders()
    ignored_designs = load_ignored()

    result = []
    total_folders = 0
    total_designs = 0
    updated_designs_count = 0
    pending_designs_count = 0

    q = search.lower().strip() if search else None

    for col in collections:
        col_copy = {
            "id": col["id"],
            "title": col["title"],
            "subtitle": col["subtitle"],
            "badge": col["badge"],
            "folders": [],
        }

        for folder in col["folders"]:
            fid = folder["folder_id"]
            is_folder_ign = fid in ignored_folders

            if filter_type == "active" and is_folder_ign:
                continue
            if filter_type == "ignored" and not is_folder_ign:
                continue

            # Contar pendientes / listos reales de la carpeta antes del status_filter
            folder_ready_cnt = 0
            folder_pending_cnt = 0
            filtered_designs = []

            for des in folder["designs"]:
                did = des["id"]
                is_des_ign = is_folder_ign or (did in ignored_designs)
                des["is_ignored"] = is_des_ign

                if filter_type == "active" and is_des_ign:
                    continue
                if filter_type == "ignored" and not is_des_ign:
                    continue

                is_up = bool(des.get("is_updated"))
                if not is_des_ign:
                    if is_up:
                        folder_ready_cnt += 1
                        updated_designs_count += 1
                    else:
                        folder_pending_cnt += 1
                        pending_designs_count += 1

                if status_filter == "pending" and is_up:
                    continue
                if status_filter == "updated" and not is_up:
                    continue

                if q:
                    m_name = q in des["name"].lower()
                    m_cat = q in des["category"].lower()
                    m_file = any(q in f["name"].lower() for f in des.get("variants", []))
                    if not (m_name or m_cat or m_file):
                        continue

                filtered_designs.append(des)

            if status_filter in ("pending", "updated") and not filtered_designs:
                continue
            if q and not filtered_designs and q not in folder["name"].lower():
                continue

            first_design_dir = (
                folder.get("folder_path")
                or (filtered_designs[0].get("folder_path") if filtered_designs else "")
            )
            folder_copy = {
                "folder_id": fid,
                "name": folder["name"],
                "collection": folder["collection"],
                "folder_path": first_design_dir,
                "designs_count": len(filtered_designs),
                "total_files": sum(d.get("variants_count", len(d.get("variants", []))) for d in filtered_designs),
                "updated_count": folder_ready_cnt,
                "pending_count": folder_pending_cnt,
                "is_ignored": is_folder_ign,
                "designs": filtered_designs,
            }

            col_copy["folders"].append(folder_copy)
            total_folders += 1
            total_designs += folder_copy["designs_count"]

        col_copy["folders_count"] = len(col_copy["folders"])
        col_copy["total_designs"] = sum(f["designs_count"] for f in col_copy["folders"])
        col_copy["updated_count"] = sum(f["updated_count"] for f in col_copy["folders"])
        col_copy["pending_count"] = sum(f["pending_count"] for f in col_copy["folders"])
        result.append(col_copy)

    return {
        "collections": result,
        "total_folders": total_folders,
        "total_designs": total_designs,
        "updated_designs_count": updated_designs_count,
        "pending_designs_count": pending_designs_count,
        "ignored_folders_count": len(ignored_folders),
        "ignored_designs_count": len(ignored_designs),
    }


class ToggleFolderIgnoreRequest(BaseModel):
    folder_id: str


@app.post("/api/toggle-folder-ignore")
async def toggle_folder_ignore(req: ToggleFolderIgnoreRequest):
    """Descarta o restaura una carpeta completa del catálogo (sin tocar el computador)."""
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
    """Descarta o restaura un diseño individual del catálogo."""
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


class ToggleUpdatedRequest(BaseModel):
    design_id: str
    force_state: Optional[bool] = None


@app.post("/api/toggle-design-updated")
async def toggle_design_updated(req: ToggleUpdatedRequest):
    """Marca o desmarca manualmente un diseño como LISTO (Verde) o FALTA IMAGEN (Rojo)."""
    collections = scan_all_designs(force_refresh=False)
    target_design = None
    for col in collections:
        for folder in col.get("folders", []):
            for des in folder.get("designs", []):
                if des.get("id") == req.design_id:
                    target_design = des
                    break
            if target_design:
                break
        if target_design:
            break

    if not target_design:
        raise HTTPException(status_code=404, detail="Diseño no encontrado")

    current_state = bool(target_design.get("is_updated"))
    new_state = (not current_state) if req.force_state is None else bool(req.force_state)

    set_design_updated_state(req.design_id, new_state)
    for var in target_design.get("variants", []):
        if var.get("file_id"):
            set_design_updated_state(var["file_id"], new_state)

    if new_state and target_design.get("photo_path"):
        p = Path(target_design["photo_path"])
        if p.exists():
            try:
                pfile = target_design.get("primary_file") or {}
                sync_photo_to_design_folder(
                    p.read_bytes(),
                    target_design.get("folder_path", ""),
                    pfile.get("path"),
                )
            except Exception:
                pass

    scan_all_designs(force_refresh=True)
    return {"success": True, "is_updated": new_state}


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

    svg_code, _w, _h = generate_toolpath_svg(str(p))
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
            win_path = os.path.normpath(str(p))
            ugs_exe = _find_windows_ugs_exe()
            if ugs_exe:
                subprocess.Popen([ugs_exe, "--open", win_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return {"success": True, "message": f"Abriendo en UGS: {p.name}"}
            os.startfile(win_path)
            return {"success": True, "message": f"Abriendo con asociación de Windows: {p.name}"}
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
    folder_path: Optional[str] = None
    file_path: Optional[str] = None


@app.post("/api/open-folder")
async def open_folder(req: OpenFolderRequest):
    target_file = Path(req.file_path) if req.file_path else None
    target_dir = Path(req.folder_path) if req.folder_path else (target_file.parent if target_file else None)

    if not target_dir or not target_dir.exists():
        raise HTTPException(status_code=404, detail="Carpeta no encontrada")

    try:
        if os.name == "nt":
            if target_file and target_file.exists():
                win_file = os.path.normpath(str(target_file))
                subprocess.Popen(["explorer.exe", f"/select,{win_file}"])
                return {"success": True, "message": f"Mostrando en Explorador: {target_file.name}"}
            win_dir = os.path.normpath(str(target_dir))
            os.startfile(win_dir)
            return {"success": True, "message": f"Carpeta abierta: {target_dir.name}"}
        else:
            env = os.environ.copy()
            env["DISPLAY"] = ":0"
            env["XAUTHORITY"] = "/home/dhamit/.Xauthority"
            subprocess.Popen(["thunar", str(target_dir)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return {"success": True, "message": f"Carpeta abierta: {target_dir.name}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class RenameFileRequest(BaseModel):
    file_path: str
    new_name: str
    design_id: Optional[str] = None


@app.post("/api/rename-file")
async def rename_file(req: RenameFileRequest):
    """Renombra un archivo de corte (.nc, .c2d, etc.) conservando su extensión y capturas asociadas."""
    old_path = Path(req.file_path)
    if not old_path.exists() or not old_path.is_file():
        raise HTTPException(status_code=404, detail="Archivo original no encontrado")

    clean_name = req.new_name.strip()
    if not clean_name or any(ch in INVALID_NAME_CHARS for ch in clean_name):
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")

    orig_ext = old_path.suffix
    if orig_ext and not clean_name.lower().endswith(orig_ext.lower()):
        clean_name = f"{clean_name}{orig_ext}"

    new_path = old_path.with_name(clean_name)
    if new_path == old_path:
        return {"success": True, "new_path": str(new_path), "new_name": new_path.name}
    if new_path.exists():
        raise HTTPException(status_code=409, detail="Ya existe un archivo con ese nombre en la carpeta")

    old_file_id = get_hash(str(old_path))
    new_file_id = get_hash(str(new_path))

    try:
        old_path.rename(new_path)

        # Renombrar imagen lateral <old_stem>.png/.jpg si existe en la misma carpeta
        for ext in IMAGE_EXTS:
            side_old = old_path.with_suffix(ext)
            if side_old.exists():
                side_new = new_path.with_suffix(ext)
                if not side_new.exists():
                    side_old.rename(side_new)

        # Migrar captura asociada en CAPTURES_DIR
        for ext in IMAGE_EXTS:
            cap_old = CAPTURES_DIR / f"{old_file_id}{ext}"
            if cap_old.exists():
                cap_new = CAPTURES_DIR / f"{new_file_id}{ext}"
                shutil.copy2(cap_old, cap_new)
                break

        reg = load_status_registry()
        if old_file_id in reg["ready"]:
            set_design_updated_state(new_file_id, True)
        elif old_file_id in reg["pending"]:
            set_design_updated_state(new_file_id, False)

        scan_all_designs(force_refresh=True)
        return {"success": True, "new_path": str(new_path), "new_name": new_path.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error renombrando archivo: {str(e)}")


class RenameFolderRequest(BaseModel):
    folder_path: str
    new_name: str
    design_id: Optional[str] = None


@app.post("/api/rename-design-folder")
async def rename_design_folder(req: RenameFolderRequest):
    """Renombra la carpeta del diseño y migra su captura y estado."""
    old_dir = Path(req.folder_path)
    if not old_dir.exists() or not old_dir.is_dir():
        raise HTTPException(status_code=404, detail="Carpeta original no encontrada")

    clean_name = req.new_name.strip()
    if not clean_name or any(ch in INVALID_NAME_CHARS for ch in clean_name):
        raise HTTPException(status_code=400, detail="Nombre de carpeta inválido")

    new_dir = old_dir.parent / clean_name
    if new_dir == old_dir:
        return {"success": True, "new_folder_path": str(new_dir), "new_name": new_dir.name}
    if new_dir.exists():
        raise HTTPException(status_code=409, detail="Ya existe una carpeta con ese nombre")

    try:
        old_folder_hash = get_hash(str(old_dir))
        new_folder_hash = get_hash(str(new_dir))

        old_dir.rename(new_dir)

        for ext in IMAGE_EXTS:
            cap_old = CAPTURES_DIR / f"{old_folder_hash}{ext}"
            if cap_old.exists():
                cap_new = CAPTURES_DIR / f"{new_folder_hash}{ext}"
                shutil.copy2(cap_old, cap_new)
                break

        # Asegurar que las variantes dentro de la carpeta renombrada conserven la foto real en folder/preview
        scan_all_designs(force_refresh=True)
        return {"success": True, "new_folder_path": str(new_dir), "new_name": new_dir.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error renombrando carpeta: {str(e)}")


class UploadCaptureBase64(BaseModel):
    design_id: str
    file_id: Optional[str] = None
    folder_path: Optional[str] = None
    file_path: Optional[str] = None
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

        set_design_updated_state(req.design_id, True)

        if req.file_id:
            var_path = CAPTURES_DIR / f"{req.file_id}.png"
            with open(var_path, "wb") as f:
                f.write(img_bytes)
            set_design_updated_state(req.file_id, True)

        folder_path = req.folder_path
        file_path = req.file_path
        if not folder_path or not file_path:
            meta_dir, meta_file, _ = _find_design_meta(design_id=req.design_id, file_id=req.file_id)
            folder_path = folder_path or meta_dir
            file_path = file_path or meta_file

        synced = sync_photo_to_design_folder(img_bytes, folder_path or "", file_path)

        scan_all_designs(force_refresh=True)
        return {"success": True, "photo_path": str(out_path), "synced_to_folder": synced}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error guardando imagen: {str(e)}")


class TriggerScreenshotRequest(BaseModel):
    design_id: str
    file_id: Optional[str] = None
    folder_path: Optional[str] = None
    file_path: Optional[str] = None


@app.post("/api/trigger-screenshot")
async def trigger_screenshot(req: TriggerScreenshotRequest):
    if os.name == "nt":
        try:
            subprocess.Popen(["explorer.exe", "ms-screenclip:"])
            return {
                "success": False,
                "windows_snip": True,
                "message": "Recorte de Windows abierto: recorta la imagen y presiona Ctrl + V sobre el cuadro de foto.",
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    out_path = CAPTURES_DIR / f"{req.design_id}.png"
    env = os.environ.copy()
    env["DISPLAY"] = ":0"
    env["XAUTHORITY"] = "/home/dhamit/.Xauthority"

    try:
        proc = subprocess.Popen(
            ["xfce4-screenshooter", "-r", "-s", str(out_path)],
            env=env,
        )
        proc.wait(timeout=30)

        if out_path.exists() and out_path.stat().st_size > 500:
            img_bytes = out_path.read_bytes()
            set_design_updated_state(req.design_id, True)

            if req.file_id:
                var_path = CAPTURES_DIR / f"{req.file_id}.png"
                with open(var_path, "wb") as dst:
                    dst.write(img_bytes)
                set_design_updated_state(req.file_id, True)

            folder_path = req.folder_path
            file_path = req.file_path
            if not folder_path or not file_path:
                meta_dir, meta_file, _ = _find_design_meta(design_id=req.design_id, file_id=req.file_id)
                folder_path = folder_path or meta_dir
                file_path = file_path or meta_file

            synced = sync_photo_to_design_folder(img_bytes, folder_path or "", file_path)
            scan_all_designs(force_refresh=True)
            return {"success": True, "photo_path": str(out_path), "synced_to_folder": synced}
        return {"success": False, "message": "Captura cancelada o vacía"}
    except subprocess.TimeoutExpired:
        proc.kill()
        return {"success": False, "message": "Tiempo agotado para la captura"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/sync-windows-previews")
async def sync_windows_previews():
    """Sincroniza todas las fotos reales del catálogo hacia sus carpetas de origen para Windows Explorer."""
    stats = sync_all_captures_to_folders()
    scan_all_designs(force_refresh=True)
    return {
        "success": True,
        "message": f"Sincronizados {stats['synced_files']} archivos en {stats['synced_folders']} carpetas para Windows Explorer.",
        **stats,
    }


@app.post("/api/refresh-index")
async def refresh_index():
    scan_all_designs(force_refresh=True)
    return {"success": True, "message": "Catálogo actualizado"}


@app.get("/api/download-zip")
async def download_zip():
    """Genera y descarga el paquete completo listo para Windows."""
    import zipfile
    import io

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for folder_name in ["app", "static", "captures", "windows_explorer_integration"]:
            folder_path = BASE_DIR / folder_name
            if folder_path.exists():
                for root, _dirs, files in os.walk(folder_path):
                    if "__pycache__" in root or ".backups" in root:
                        continue
                    for file in files:
                        if not file.endswith((".pyc", ".tmp")):
                            full_path = Path(root) / file
                            rel_path = full_path.relative_to(BASE_DIR)
                            zip_file.write(full_path, rel_path)
        for root_file in ["INICIAR_CATALOGO_WINDOWS.bat", "README.md", "updated_designs.json", "ignored_designs.json", "ignored_folders.json"]:
            rf = BASE_DIR / root_file
            if rf.exists():
                zip_file.write(rf, rf.relative_to(BASE_DIR))

    zip_buffer.seek(0)
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=CatalogoCNC-Windows.zip"},
    )
