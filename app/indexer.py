import os
import re
import json
import hashlib
from pathlib import Path
from typing import Optional

try:
    from PIL import Image
except ImportError:
    Image = None

BASE_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = BASE_DIR / "cache"
CAPTURES_DIR = BASE_DIR / "captures"
DATA_FILE = BASE_DIR / "catalog_data.json"
IGNORED_FILE = BASE_DIR / "ignored_designs.json"
IGNORED_FOLDERS_FILE = BASE_DIR / "ignored_folders.json"
UPDATED_STATUS_FILE = BASE_DIR / "updated_designs.json"

CACHE_DIR.mkdir(parents=True, exist_ok=True)
CAPTURES_DIR.mkdir(parents=True, exist_ok=True)

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
CUT_EXTS = (".nc", ".gcode", ".ngc", ".tap", ".dxf", ".c2d")

if os.name == "nt":
    user_prof = os.environ.get("USERPROFILE", r"C:\Users\rober")
    candidates = [
        Path(user_prof) / "Desktop" / "produccion cnc dhani",
        Path(user_prof) / "Escritorio" / "produccion cnc dhani",
        Path(user_prof) / "Desktop",
        Path(r"C:\produccion cnc dhani"),
    ]
    default_root = next((c for c in candidates if c.exists()), candidates[0])
    MASTER_ROOT = Path(os.environ.get("CNC_ROOT", str(default_root)))
else:
    MASTER_ROOT = Path(os.environ.get("CNC_ROOT", "/home/dhamit/Documentos/DISEÑOS-CNC-AMBAR-Y-GUSSEL-ANTIGUOS"))


def _load_json_set(path: Path) -> set:
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return set(data)
        except Exception:
            pass
    return set()


def _save_json_set(path: Path, values: set) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sorted(list(values)), f, indent=2, ensure_ascii=False)


def load_ignored():
    return _load_json_set(IGNORED_FILE)


def save_ignored(ignored_set):
    _save_json_set(IGNORED_FILE, ignored_set)


def load_ignored_folders():
    return _load_json_set(IGNORED_FOLDERS_FILE)


def save_ignored_folders(folders_set):
    _save_json_set(IGNORED_FOLDERS_FILE, folders_set)


def load_status_registry() -> dict:
    """Carga el registro de estados rojo/verde (ready vs pending)."""
    if UPDATED_STATUS_FILE.exists():
        try:
            with open(UPDATED_STATUS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return {"ready": set(data), "pending": set()}
                if isinstance(data, dict):
                    return {
                        "ready": set(data.get("ready", [])),
                        "pending": set(data.get("pending", [])),
                    }
        except Exception:
            pass
    return {"ready": set(), "pending": set()}


def save_status_registry(registry: dict) -> None:
    payload = {
        "ready": sorted(list(registry.get("ready", set()))),
        "pending": sorted(list(registry.get("pending", set()))),
    }
    with open(UPDATED_STATUS_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def load_updated_designs() -> set:
    return load_status_registry()["ready"]


def save_updated_designs(updated_set: set) -> None:
    reg = load_status_registry()
    reg["ready"] = set(updated_set)
    save_status_registry(reg)


def set_design_updated_state(item_id: str, is_ready: bool) -> None:
    reg = load_status_registry()
    if is_ready:
        reg["ready"].add(item_id)
        reg["pending"].discard(item_id)
    else:
        reg["ready"].discard(item_id)
        reg["pending"].add(item_id)
    save_status_registry(reg)


def get_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12]


def resolve_photo_with_source(
    file_id: Optional[str] = None,
    folder_path: Optional[str] = None,
    design_id: Optional[str] = None,
    files_in_dir: Optional[list] = None,
    file_stem: Optional[str] = None,
):
    """
    Resuelve la ruta de foto y si cuenta como imagen real actualizada.
    Retorna (photo_path, is_dedicated_real_photo).
    """
    # 1. Foto lateral exacta en la carpeta del corte (<nombre_archivo>.png/.jpg)
    if folder_path and file_stem:
        for ext in IMAGE_EXTS:
            candidate = Path(folder_path) / f"{file_stem}{ext}"
            if candidate.exists():
                return str(candidate), True

    # 2. Captura directa de archivo de corte específico en CAPTURES_DIR
    if file_id:
        for ext in IMAGE_EXTS:
            p = CAPTURES_DIR / f"{file_id}{ext}"
            if p.exists():
                return str(p), True

    # 3. Captura directa asignada al modelo/diseño
    if design_id:
        for ext in IMAGE_EXTS:
            p = CAPTURES_DIR / f"{design_id}{ext}"
            if p.exists():
                return str(p), True

    # 4. Captura por hash de carpeta/subcarpeta
    if folder_path:
        f_hash = get_hash(folder_path)
        for ext in IMAGE_EXTS:
            p = CAPTURES_DIR / f"{f_hash}{ext}"
            if p.exists():
                return str(p), True

        # 5. preview.png / preview.jpg dentro de la carpeta del diseño
        for pname in ("preview.png", "preview.jpg", "preview.jpeg", "folder.png", "folder.jpg"):
            pp = Path(folder_path) / pname
            if pp.exists():
                return str(pp), True

    # 6. Foto existente en la carpeta del corte (puede no estar confirmada aún como definitiva)
    if folder_path and files_in_dir:
        for f in sorted(files_in_dir):
            if f.lower().endswith(IMAGE_EXTS):
                return os.path.join(folder_path, f), True

    return None, False


def resolve_capture_or_photo(file_id=None, folder_path=None, design_id=None, files_in_dir=None, file_stem=None):
    """Compatibilidad con firma previa."""
    path, _ = resolve_photo_with_source(
        file_id=file_id,
        folder_path=folder_path,
        design_id=design_id,
        files_in_dir=files_in_dir,
        file_stem=file_stem,
    )
    return path


def sync_photo_to_design_folder(photo_bytes: bytes, folder_path: str, file_path: Optional[str] = None) -> list:
    """
    Guarda la foto real directamente dentro de la carpeta del diseño para que
    el Explorador de Windows la muestre en el Panel de Vista Previa y en Iconos Muy Grandes.
    """
    written = []
    if not folder_path:
        return written
    target_dir = Path(folder_path)
    if not target_dir.exists() or not target_dir.is_dir():
        return written

    # Guardar preview.png general en la carpeta
    preview_png = target_dir / "preview.png"
    with open(preview_png, "wb") as f:
        f.write(photo_bytes)
    written.append(str(preview_png))

    # Guardar imagen con el nombre exacto del archivo .nc/.c2d (ej: arbol.nc -> arbol.png)
    if file_path:
        stem = Path(file_path).stem
        sidecar_png = target_dir / f"{stem}.png"
        with open(sidecar_png, "wb") as f:
            f.write(photo_bytes)
        written.append(str(sidecar_png))

    # Si Pillow está disponible, generar folder.jpg válido para vistas de carpetas en Windows
    if Image is not None:
        try:
            import io
            img = Image.open(io.BytesIO(photo_bytes)).convert("RGB")
            folder_jpg = target_dir / "folder.jpg"
            img.save(folder_jpg, format="JPEG", quality=92)
            written.append(str(folder_jpg))
        except Exception:
            pass

    return written


def sync_all_captures_to_folders() -> dict:
    """
    Copia todas las fotos reales disponibles en el catálogo directamente a sus
    carpetas de diseño para habilitar las miniaturas y vista previa nativa de Windows.
    """
    collections = scan_all_designs(force_refresh=False)
    synced_files = 0
    synced_folders = set()

    for col in collections:
        for folder in col.get("folders", []):
            for design in folder.get("designs", []):
                d_photo = design.get("photo_path")
                if d_photo and Path(d_photo).exists() and design.get("is_updated"):
                    try:
                        img_bytes = Path(d_photo).read_bytes()
                        p_file = design.get("primary_file", {}) or {}
                        out = sync_photo_to_design_folder(
                            img_bytes,
                            design.get("folder_path", ""),
                            p_file.get("path"),
                        )
                        if out:
                            synced_files += len(out)
                            synced_folders.add(design.get("folder_path", ""))
                    except Exception:
                        pass

                for var in design.get("variants", []):
                    v_photo = var.get("photo_path") or d_photo
                    v_updated = var.get("is_updated") or design.get("is_updated")
                    if v_photo and Path(v_photo).exists() and v_updated:
                        try:
                            img_bytes = Path(v_photo).read_bytes()
                            out = sync_photo_to_design_folder(
                                img_bytes,
                                var.get("folder_path", ""),
                                var.get("path"),
                            )
                            if out:
                                synced_files += len(out)
                                synced_folders.add(var.get("folder_path", ""))
                        except Exception:
                            pass

    return {"synced_files": synced_files, "synced_folders": len(synced_folders)}


def extract_broca(text: str) -> str:
    """Extrae el calibre de la broca (B1.5, B2, B2.5, B3)"""
    t = text.lower()
    m = re.search(r"\bbroca\s*(?:de)?\s*([0-9]+(?:\.[0-9]+)?)\b", t)
    if m:
        return f"B{m.group(1)}"
    m2 = re.search(r"\bb-?u?([0-9]+(?:\.[0-9]+)?)\b", t)
    if m2:
        return f"B{m2.group(1)}"
    m3 = re.search(r"[/\s_]([123](?:\.[05])?)(?:mm)?[/\s_]", t)
    if m3:
        return f"B{m3.group(1)}"
    return "B2"


def extract_dimensions_from_name(filename: str):
    """Extrae medidas nominales del nombre de archivo"""
    m = re.search(r"(\d+(?:\.\d+)?)\s*[xX*]\s*(\d+(?:\.\d+)?)", filename)
    if m:
        try:
            return float(m.group(1)), float(m.group(2)), f"{m.group(1)} × {m.group(2)} mm"
        except Exception:
            pass
    m2 = re.search(r"\b(?:larg|radio|d|r)?\s*(\d+(?:\.\d+)?)\s*mm\b", filename.lower())
    if m2:
        try:
            val = float(m2.group(1))
            return val, val, f"{val} mm"
        except Exception:
            pass
    return 0.0, 0.0, "Medida Estándar"


def scan_all_designs(force_refresh: bool = False):
    if not force_refresh and DATA_FILE.exists():
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading cache data: {e}")

    ignored_designs = load_ignored()
    ignored_folders = load_ignored_folders()
    status_reg = load_status_registry()
    ready_ids = status_reg["ready"]
    pending_override = status_reg["pending"]

    # Mapear fotos generales existentes
    general_photos = {}
    general_dir = MASTER_ROOT / "CNC" / "FOTOS DE DISEÑOS GENERAL"
    if general_dir.exists():
        for f in os.listdir(general_dir):
            if f.lower().endswith(IMAGE_EXTS):
                key = Path(f).stem.lower().strip()
                general_photos[key] = str(general_dir / f)

    collections = {
        "ambar": {
            "id": "ambar",
            "title": "Ámbar del Sur",
            "subtitle": "Colección completa de diseños Ámbar del Sur",
            "badge": "Ámbar",
            "folders": {},
        },
        "guissel": {
            "id": "guissel",
            "title": "Guissel",
            "subtitle": "Colección de Diseños Gisse, Cuelga Gisehs y figuras",
            "badge": "Guissel",
            "folders": {},
        },
        "otros": {
            "id": "otros",
            "title": "Extras y Prototipos",
            "subtitle": "Diseños adicionales, pruebas y versiones anteriores",
            "badge": "Extras",
            "folders": {},
        },
    }

    if MASTER_ROOT.exists():
        for root, _dirs, files in os.walk(MASTER_ROOT):
            if any(p in root.upper() for p in ["DEMO", "DEMOS", ".GIT", "TMP"]):
                continue

            nc_files = [f for f in files if f.lower().endswith(CUT_EXTS)]
            if not nc_files:
                continue

            rel = os.path.relpath(root, MASTER_ROOT)
            parts = rel.split(os.sep)
            p_up = rel.upper()

            if "AMBAR" in p_up:
                col_id = "ambar"
            elif "GUISSEL" in p_up or "GISSE" in p_up or "GISEL" in p_up:
                col_id = "guissel"
            else:
                col_id = "otros"

            shape_category = parts[1] if len(parts) > 1 else parts[0]
            if shape_category.upper() in ["CUELGA GISEPHS", "Z DHANI", "EXTRAS", "CNC", "DISEÑOS GISSE", "AMBAR DEL SUR"]:
                if len(parts) > 2:
                    shape_category = parts[2]

            folder_id = get_hash(f"{col_id}_{shape_category}")

            sub_concept = parts[-1]
            if sub_concept in ["1.5", "2", "2.5", "3", "NORMAL_", "MIRROR_", ".NC", "NC"] or sub_concept == shape_category:
                if len(parts) > 2 and parts[-2] not in ["AMBAR DEL SUR", "CNC", "DISEÑOS GISSE", "CUELGA GISEPHS"]:
                    sub_concept = parts[-2]
                else:
                    sub_concept = shape_category

            design_id = get_hash(f"{col_id}_{shape_category}_{sub_concept}")

            photo_path, has_dedicated = resolve_photo_with_source(
                design_id=design_id,
                folder_path=root,
                files_in_dir=files,
            )

            used_general_fallback = False
            if not photo_path:
                norm_name = sub_concept.lower().replace("_", " ").strip()
                for key, gpath in general_photos.items():
                    if key in norm_name or norm_name in key:
                        photo_path = gpath
                        used_general_fallback = True
                        break

            # Estado verde si tiene foto dedicada o fue marcado manualmente en ready, salvo que esté en pending_override
            design_is_updated = (
                (design_id in ready_ids) or (has_dedicated and not used_general_fallback)
            ) and (design_id not in pending_override)

            variants = []
            brocas_found = set()
            dimensions_found = set()

            for fn in sorted(nc_files):
                full_fpath = os.path.join(root, fn)
                broca = extract_broca(f"{root} {fn}")
                w, h, dim_label = extract_dimensions_from_name(fn)
                brocas_found.add(broca)
                if dim_label != "Medida Estándar":
                    dimensions_found.add(dim_label)

                v_file_id = get_hash(full_fpath)
                v_photo, v_dedicated = resolve_photo_with_source(
                    file_id=v_file_id,
                    folder_path=root,
                    files_in_dir=files,
                    file_stem=Path(fn).stem,
                )
                v_is_updated = (
                    (v_file_id in ready_ids) or (design_id in ready_ids) or v_dedicated
                ) and (v_file_id not in pending_override) and (design_id not in pending_override)

                variants.append({
                    "file_id": v_file_id,
                    "name": fn,
                    "path": full_fpath,
                    "folder_path": root,
                    "folder_hash": get_hash(root),
                    "broca": broca,
                    "width": w,
                    "height": h,
                    "dim_label": dim_label,
                    "has_gcode": full_fpath.lower().endswith((".nc", ".gcode", ".tap")),
                    "ext": Path(fn).suffix.lower(),
                    "photo_path": v_photo,
                    "has_real_photo": bool(v_photo),
                    "is_updated": v_is_updated,
                })

            col_dict = collections[col_id]["folders"]
            if folder_id not in col_dict:
                col_dict[folder_id] = {
                    "folder_id": folder_id,
                    "name": shape_category,
                    "collection": col_id,
                    "folder_path": root,
                    "designs_dict": {},
                    "is_ignored": folder_id in ignored_folders,
                }

            d_dict = col_dict[folder_id]["designs_dict"]
            if design_id not in d_dict:
                d_dict[design_id] = {
                    "id": design_id,
                    "name": sub_concept,
                    "category": shape_category,
                    "collection": col_id,
                    "folder_path": root,
                    "variants": [],
                    "available_brocas": set(),
                    "available_dimensions": set(),
                    "photo_path": photo_path,
                    "has_real_photo": bool(photo_path),
                    "is_updated": design_is_updated,
                    "is_ignored": (folder_id in ignored_folders) or (design_id in ignored_designs),
                }

            d_dict[design_id]["variants"].extend(variants)
            d_dict[design_id]["available_brocas"].update(brocas_found)
            d_dict[design_id]["available_dimensions"].update(dimensions_found)
            if not d_dict[design_id]["photo_path"] and photo_path:
                d_dict[design_id]["photo_path"] = photo_path
                d_dict[design_id]["has_real_photo"] = True
            if design_is_updated and (design_id not in pending_override):
                d_dict[design_id]["is_updated"] = True

    result_collections = []
    for cid in ["ambar", "guissel", "otros"]:
        cdata = collections[cid]
        folder_list = []

        for _fid, fobj in cdata["folders"].items():
            designs_list = []
            for _did, dobj in fobj["designs_dict"].items():
                dobj["available_brocas"] = sorted(list(dobj["available_brocas"]))
                dobj["available_dimensions"] = sorted(list(dobj["available_dimensions"]))
                dobj["variants_count"] = len(dobj["variants"])
                first_gcode = next((v for v in dobj["variants"] if v["has_gcode"]), None)
                dobj["primary_file"] = first_gcode or (dobj["variants"][0] if dobj["variants"] else None)

                if not dobj["has_real_photo"] or not dobj["photo_path"]:
                    for v in dobj["variants"]:
                        if v.get("has_real_photo") and v.get("photo_path"):
                            dobj["photo_path"] = v["photo_path"]
                            dobj["has_real_photo"] = True
                            break

                # Si alguna variante tiene foto real confirmada y el diseño no fue marcado pendiente
                if not dobj["is_updated"] and dobj["id"] not in pending_override:
                    if any(v.get("is_updated") for v in dobj["variants"]):
                        dobj["is_updated"] = True

                designs_list.append(dobj)

            designs_list.sort(key=lambda x: x["name"].lower())

            fobj["designs"] = designs_list
            fobj["designs_count"] = len(designs_list)
            fobj["total_files"] = sum(d["variants_count"] for d in designs_list)
            fobj["updated_count"] = sum(1 for d in designs_list if d.get("is_updated") and not d.get("is_ignored"))
            fobj["pending_count"] = sum(1 for d in designs_list if not d.get("is_updated") and not d.get("is_ignored"))
            del fobj["designs_dict"]
            folder_list.append(fobj)

        folder_list.sort(key=lambda x: x["name"].lower())
        cdata["folders"] = folder_list
        cdata["folders_count"] = len(folder_list)
        cdata["total_designs"] = sum(f["designs_count"] for f in folder_list)
        cdata["updated_count"] = sum(f["updated_count"] for f in folder_list)
        cdata["pending_count"] = sum(f["pending_count"] for f in folder_list)
        result_collections.append(cdata)

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(result_collections, f, indent=2, ensure_ascii=False)

    return result_collections
