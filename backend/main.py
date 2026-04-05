"""
backend/main.py  —  SEIS Backend (Supabase edition) [Refreshed]

All file/folder operations now use Supabase Storage + PostgreSQL.
API response shapes are identical to the original so the frontend
needs zero changes.
"""

import logging
import time
from typing import Union

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

from backend.orchestrator.router import route_chat
from backend.tools import rag_tool, hardware_tool
from backend.services.supabase_client import supabase, BUCKET, execute_with_retry, reconnect
from backend.services import device_detector, speech_service

# -------------------- LOAD ENV --------------------
load_dotenv(dotenv_path=".env")

app = FastAPI(title="SEIS Backend — Supabase")

# -------------------- CORS --------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Allowed file extensions for upload (unchanged)
ALLOWED_EXTENSIONS = {
    ".txt", ".py", ".c", ".cpp", ".h", ".hpp",
    ".java", ".asm", ".s", ".pdf", ".docx", ".pptx",
    ".js", ".ts", ".jsx", ".tsx", ".md"
}


# ==================================================
# REQUEST MODELS  (unchanged)
# ==================================================

class ChatRequest(BaseModel):
    mode: str | None = None
    session_id: str | None = None

    # Document
    question: str | None = None
    folder: str | None = None

    # Code
    code: str | None = None
    error_log: str | None = None
    language: str | None = None
    task: str | None = "fix"
    instruction: str | None = None

    # Hardware
    device_id: str | None = None
    sensor_type: str | None = None


class SensorData(BaseModel):
    device_id: str
    sensor_type: str
    value: float
    timestamp: float | None = None


class RepoRequest(BaseModel):
    repo_url: str
    branch: str = "main"


# ==================================================
# RESPONSE MODELS
# ==================================================

class ErrorResponse(BaseModel):
    error: str


# ==================================================
# HELPERS
# ==================================================

def _get_folder_or_404(folder_name: str) -> dict:
    """Fetch a folder row by name or raise 404. Auto-reconnects on SSL errors."""
    try:
        resp = execute_with_retry(
            lambda sb: (
                sb.table("folders")
                .select("id, name")
                .eq("name", folder_name)
                .single()
                .execute()
            )
        )
    except Exception as exc:
        logger.exception("[_get_folder_or_404] Supabase query failed for folder=%r", folder_name)
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    if not resp.data:
        raise HTTPException(status_code=404, detail="Folder not found")

    return resp.data


def _storage_list(prefix: str) -> list[str]:
    """
    List all object paths under *prefix* in the seis-files bucket.
    Returns a flat list of full storage paths.
    """
    try:
        items = supabase.storage.from_(BUCKET).list(prefix)
        paths = []
        for item in items or []:
            name = item.get("name", "")
            if name:
                paths.append(f"{prefix}/{name}" if prefix else name)
        return paths
    except Exception:
        return []


def _storage_delete_prefix(prefix: str):
    """Delete all objects whose path starts with `prefix/`."""
    paths = _storage_list(prefix)
    if paths:
        try:
            supabase.storage.from_(BUCKET).remove(paths)
        except Exception:
            pass


# ==================================================
# HEALTH CHECK
# ==================================================

@app.get("/health")
def health():
    return {"status": "ok", "service": "SEIS Backend"}


# ==================================================

@app.get("/debug/folder/{folder_name:path}")
def debug_folder(folder_name: str):
    """Full diagnostic: DB state + live test-index on first file."""
    import traceback as _tb
    result = {}

    # 1. Folder row
    try:
        fr = supabase.table("folders").select("id, name").eq("name", folder_name).execute()
        result["folder_row"] = fr.data
    except Exception as e:
        result["folder_row_error"] = str(e)
        return result

    if not fr.data:
        result["error"] = "Folder not found in DB"
        return result

    folder_id = fr.data[0]["id"]
    result["folder_id"] = folder_id

    # 2. Files in folder
    try:
        files_resp = supabase.table("files").select("id, name, storage_path").eq("folder_id", folder_id).execute()
        result["files"] = files_resp.data
        result["file_count"] = len(files_resp.data or [])
    except Exception as e:
        result["files_error"] = str(e)
        return result

    # 3. Embedding count — try both folder_id and file_id filters
    try:
        emb_all = supabase.table("embeddings").select("id", count="exact").execute()
        result["embeddings_total_in_table"] = emb_all.count
    except Exception as e:
        result["embeddings_total_error"] = str(e)

    if files_resp.data:
        first_file_id = files_resp.data[0]["id"]
        try:
            emb_by_file = supabase.table("embeddings").select("id", count="exact").eq("file_id", first_file_id).execute()
            result["embeddings_for_first_file"] = emb_by_file.count
        except Exception as e:
            result["embeddings_for_first_file_error"] = str(e)

    try:
        emb_resp = supabase.table("embeddings").select("id", count="exact").eq("folder_id", folder_id).execute()
        result["embedding_count_by_folder_id"] = emb_resp.count
    except Exception as e:
        result["embedding_count_by_folder_id_error"] = str(e)

    # 4. Test match_chunks RPC
    try:
        from backend.services.embeddings import embed_texts
        test_vec = embed_texts(["test"])[0].tolist()
        rpc_resp = supabase.rpc("match_chunks", {
            "query_embedding": test_vec,
            "target_folder_id": folder_id,
            "match_count": 3,
        }).execute()
        result["match_chunks_rows"] = len(rpc_resp.data or [])
        result["match_chunks_sample"] = (rpc_resp.data or [])[:1]
    except Exception as e:
        result["match_chunks_error"] = str(e)

    # 5. LIVE TEST: attempt to index the first file step-by-step
    if not files_resp.data:
        result["live_test"] = "no files to test"
        return result

    first = files_resp.data[0]
    live = {"file": first["name"], "storage_path": first["storage_path"]}

    # Step A: download
    try:
        raw = supabase.storage.from_(BUCKET).download(first["storage_path"])
        live["download_bytes"] = len(raw)
    except Exception as e:
        live["download_error"] = str(e)
        result["live_test"] = live
        return result

    # Step B: read text
    try:
        from backend.tools.rag_tool import _read_file_content, chunk_text
        text = _read_file_content(first["name"], raw)
        live["text_chars"] = len(text)
        live["text_empty"] = len(text.strip()) == 0
    except Exception as e:
        live["read_error"] = str(e)
        result["live_test"] = live
        return result

    if not text.strip():
        live["skip_reason"] = "extracted text is empty — unsupported file type or blank file"
        result["live_test"] = live
        return result

    # Step C: chunk
    try:
        chunks = chunk_text(text)
        live["chunk_count"] = len(chunks)
    except Exception as e:
        live["chunk_error"] = str(e)
        result["live_test"] = live
        return result

    # Step D: embed
    try:
        from backend.services.embeddings import embed_texts
        vectors = embed_texts(chunks[:3])  # only first 3 chunks for speed
        live["embed_ok"] = True
        live["embed_shape"] = list(vectors.shape)
    except Exception as e:
        live["embed_error"] = str(e)
        result["live_test"] = live
        return result

    # Step E: insert one test row
    try:
        test_row = {
            "folder_id":  folder_id,
            "file_id":    first["id"],
            "chunk_text": chunks[0],
            "embedding":  vectors[0].tolist(),
        }
        ins = supabase.table("embeddings").insert(test_row).execute()
        live["insert_ok"] = True
        live["inserted_row_id"] = (ins.data or [{}])[0].get("id")
    except Exception as e:
        live["insert_error"] = str(e)
        live["insert_error_detail"] = _tb.format_exc()

    result["live_test"] = live
    return result


# ==================================================
# FOLDER LISTING
# ==================================================

@app.get("/folders")
def list_folders():
    """Return all project folders and subfolders with file count."""
    try:
        resp = supabase.table("folders").select(
            "id, name, files(count)"
        ).execute()
    except Exception as exc:
        logger.exception("[list_folders] Supabase query failed")
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    folders = []
    for row in resp.data or []:
        # Supabase returns nested count as [{"count": N}] for aggregated selects
        file_count = 0
        files_agg = row.get("files")
        if isinstance(files_agg, list) and files_agg:
            file_count = files_agg[0].get("count", 0)
        elif isinstance(files_agg, int):
            file_count = files_agg
        folders.append({"folder": row["name"], "file_count": file_count})

    # Sort so parents always appear before their children (lexicographic is fine for /)
    return {"folders": sorted(folders, key=lambda x: x["folder"])}


# ==================================================
# FILE LISTING
# ==================================================

@app.get("/folders/{folder_path:path}/files")
def list_files(folder_path: str):
    """Return all files inside a project folder or subfolder."""
    folder = _get_folder_or_404(folder_path)
    logger.debug("[list_files] folder_path=%r  resolved folder_id=%r", folder_path, folder["id"])

    try:
        resp = (
            supabase.table("files")
            .select("name, storage_path, size_bytes, folder_id")
            .eq("folder_id", folder["id"])
            .execute()
        )
    except Exception as exc:
        logger.exception("[list_files] Supabase query failed for folder=%r", folder_path)
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    logger.debug("[list_files] raw rows returned: %r", resp.data)

    files = []
    for f in resp.data or []:
        # Compute relative path from storage_path by stripping folder prefix
        storage_path = f.get("storage_path", "")
        rel = storage_path.replace(f"{folder_path}/", "", 1)
        files.append({
            "name":       f["name"],
            "path":       rel,
            "size_bytes": f.get("size_bytes", 0),
        })

    return {"folder": folder_path, "files": files}


# ==================================================
# FOLDER MANAGEMENT
# ==================================================

def _create_folder_by_name(full_name: str) -> dict:
    """Shared logic: insert a folder row (top-level or subfolder)."""
    try:
        existing = (
            supabase.table("folders")
            .select("id")
            .eq("name", full_name)
            .execute()
        )
    except Exception as exc:
        logger.exception("[_create_folder_by_name] Supabase check-existing failed for folder=%r", full_name)
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    if existing.data:
        return {"message": "Folder already exists", "folder": full_name}

    try:
        supabase.table("folders").insert({"name": full_name}).execute()
    except Exception as exc:
        logger.exception("[_create_folder_by_name] Supabase insert failed for folder=%r", full_name)
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    return {"message": "Folder created", "folder": full_name}


# --------------------------------------------------
# REINDEX  (must be registered BEFORE catch-all POST routes)
# --------------------------------------------------

@app.post("/folders/{folder_path:path}/reindex")
def reindex_folder(folder_path: str):
    """Delete all embeddings for a folder then rebuild from Storage."""
    folder = _get_folder_or_404(folder_path)
    rag_tool.index_folder(folder["id"], folder_path)
    return {
        "message": "Index rebuilt successfully",
        "folder":  folder_path
    }


# --------------------------------------------------
# FILE MANAGEMENT  (specific DELETE before catch-all folder DELETE)
# --------------------------------------------------

@app.delete("/folders/{folder_path:path}/files/{filename}")
def delete_file(folder_path: str, filename: str):
    folder = _get_folder_or_404(folder_path)

    # Look up the file row
    try:
        resp = (
            supabase.table("files")
            .select("id, storage_path")
            .eq("folder_id", folder["id"])
            .eq("name", filename)
            .single()
            .execute()
        )
    except Exception as exc:
        logger.exception("[delete_file] Supabase query failed for folder=%r file=%r", folder_path, filename)
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    if not resp.data:
        raise HTTPException(status_code=404, detail="File not found")

    file_row = resp.data

    # Delete from Storage
    try:
        supabase.storage.from_(BUCKET).remove([file_row["storage_path"]])
    except Exception:
        pass   # non-fatal — continue with DB cleanup

    # Delete embeddings for this file
    rag_tool.delete_embeddings_for_file(file_row["id"])

    # Delete files row
    try:
        supabase.table("files").delete().eq("id", file_row["id"]).execute()
    except Exception as exc:
        logger.exception("[delete_file] Supabase delete failed for file_id=%r", file_row["id"])
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    return {"message": "File deleted and index cleared"}


# --------------------------------------------------
# FOLDER DELETE  (catch-all — after /files/{filename})
# --------------------------------------------------

@app.delete("/folders/{folder_path:path}")
def delete_folder(folder_path: str):
    folder = _get_folder_or_404(folder_path)

    # Delete all Storage objects under this folder
    _storage_delete_prefix(folder_path)

    # Delete the folder row — cascades to files + embeddings in DB
    try:
        supabase.table("folders").delete().eq("id", folder["id"]).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    return {"message": "Folder deleted", "folder": folder_path}


# --------------------------------------------------
# FOLDER CREATION  (catch-all POST — must be LAST among POST /folders/...)
# Handles both top-level ("TEST1") and subfolders ("TEST1/Experiments").
# The parent folder is NOT required to exist for top-level names.
# For subfolders (name contains "/"), the parent must exist.
# --------------------------------------------------

@app.post("/folders/{folder_name}")
def create_folder(folder_name: str):
    """Create a top-level project folder (no slashes in name)."""
    return _create_folder_by_name(folder_name)


@app.post("/folders/{folder_path:path}")
def create_folder_or_subfolder(folder_path: str):
    """
    Create a subfolder.  folder_path may contain slashes, e.g. "TEST1/Experiments".
    The immediate parent must already exist.
    """
    # Validate parent exists when there is a parent segment
    parent = folder_path.rsplit("/", 1)[0] if "/" in folder_path else None
    if parent:
        _get_folder_or_404(parent)   # raises 404 if parent missing

    result = _create_folder_by_name(folder_path)
    if result["message"] == "Folder created" and "/" in folder_path:
        result["message"] = "Subfolder created"
    return result


# ==================================================
# UPLOAD
# ==================================================

@app.post("/upload/{folder_path:path}")
def upload_file(folder_path: str, file: UploadFile = File(...)):
    folder = _get_folder_or_404(folder_path)
    logger.debug("[upload_file] folder_path=%r  resolved folder_id=%r", folder_path, folder["id"])

    # Validate extension
    import os
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File type '{ext}' not supported. Allowed: {sorted(ALLOWED_EXTENSIONS)}"
        )

    content = file.file.read()
    storage_path = f"{folder_path}/{file.filename}"

    # Upload to Supabase Storage (upsert = overwrite if exists)
    try:
        supabase.storage.from_(BUCKET).upload(
            path=storage_path,
            file=content,
            file_options={"upsert": "true", "content-type": "application/octet-stream"},
        )
    except Exception as exc:
        logger.exception("[upload_file] Supabase Storage upload failed for folder=%r file=%r", folder_path, file.filename)
        raise HTTPException(status_code=503, detail=f"Storage unavailable: {exc}")

    # Upsert file metadata row
    try:
        existing_file = (
            supabase.table("files")
            .select("id")
            .eq("folder_id", folder["id"])
            .eq("name", file.filename)
            .execute()
        )
        if existing_file.data:
            file_id = existing_file.data[0]["id"]
            logger.debug("[upload_file] updating existing file row id=%r with folder_id=%r", file_id, folder["id"])
            supabase.table("files").update({
                "path":         storage_path,
                "storage_path": storage_path,
                "size_bytes":   len(content),
            }).eq("id", file_id).execute()
        else:
            new_row = supabase.table("files").insert({
                "folder_id":    folder["id"],
                "name":         file.filename,
                "path":         storage_path,
                "storage_path": storage_path,
                "size_bytes":   len(content),
            }).execute()
            file_id = new_row.data[0]["id"]
            logger.debug("[upload_file] inserted new file row id=%r with folder_id=%r", file_id, folder["id"])
    except Exception as exc:
        logger.exception("[upload_file] Supabase DB upsert failed for folder=%r file=%r", folder_path, file.filename)
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    # Index this file (generate + store embeddings)
    print(f"[upload_file] starting index_file for folder_id={folder['id']!r} file={file.filename!r}", flush=True)
    index_warning = None
    try:
        rag_tool.index_file(folder["id"], file_id, storage_path, file.filename)
    except Exception as _idx_exc:
        import traceback as _tb
        print(
            f"[upload_file] WARNING: indexing FAILED for folder={folder_path!r} file={file.filename!r}\n"
            f"{_tb.format_exc()}",
            flush=True,
        )
        index_warning = f"File saved but indexing failed: {_idx_exc}. Please click Re-index to retry."

    response = {
        "message":  "File uploaded successfully",
        "folder":   folder_path,
        "filename": file.filename,
    }
    if index_warning:
        response["warning"] = index_warning
    return response


# ==================================================
# CHAT (Hybrid Orchestrated)
# ==================================================

@app.post("/chat", response_model=Union[dict, ErrorResponse])
def chat(request: ChatRequest):

    if request.mode == "document":
        if not request.question:
            raise HTTPException(status_code=400, detail="Document mode requires a question.")

    if request.mode == "code":
        if request.task == "fix" and not request.code:
            raise HTTPException(status_code=400, detail="Fix mode requires 'code'.")
        if request.task == "generate" and not request.instruction:
            raise HTTPException(status_code=400, detail="Generate mode requires 'instruction'.")

    if request.mode == "hardware":
        if not request.device_id or not request.sensor_type or not request.question:
            raise HTTPException(
                status_code=400,
                detail="Hardware mode requires device_id, sensor_type, and question."
            )

    result = route_chat(request)

    # ── Persist chat history ──────────────────────────────────────────────
    user_message = (
        request.question or request.instruction or request.code or ""
    )
    assistant_answer = ""
    if isinstance(result, dict):
        assistant_answer = (
            result.get("answer") or
            result.get("analysis") or
            result.get("explanation") or
            result.get("code") or
            ""
        )

    if user_message:
        try:
            supabase.table("chat_history").insert([
                {
                    "role":       "user",
                    "message":    user_message,
                    "session_id": request.session_id,
                },
                {
                    "role":       "assistant",
                    "message":    str(assistant_answer),
                    "session_id": request.session_id,
                },
            ]).execute()
        except Exception:
            pass   # chat history failure must never break the response

    return result


@app.get("/chat/history/{session_id}")
def get_chat_history(session_id: str):
    try:
        response = supabase.table("chat_history").select("*").eq("session_id", session_id).order("created_at").execute()
        return response.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================================================
# HARDWARE DATA INGESTION
# ==================================================
@app.post("/hardware/data")
def receive_sensor_data(data: SensorData):
    return hardware_tool.store_reading(
        device_id=data.device_id,
        sensor_type=data.sensor_type,
        value=data.value,
        timestamp=data.timestamp,
    )


# ==================================================
# HARDWARE DETECTION
# ==================================================

@app.get("/hardware/detect")
def detect_hardware():
    """Scan all COM/USB ports and return found devices."""
    try:
        devices = device_detector.detect_devices()
        return {"status": "success", "devices": devices}
    except Exception as exc:
        logger.exception("[detect_hardware] Scan failed")
        return {"status": "error", "error": str(exc)}

@app.post("/hardware/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Transcribe a chunk of audio using Gemini 1.5 Flash (robust)."""
    try:
        audio_content = await file.read()
        res = speech_service.transcribe_audio_robust(audio_content, file.content_type or "audio/webm")
        return res
    except Exception as e:
        logger.error(f"[transcribe_audio] Failed: {e}")
        return {"text": "", "error": str(e)}


# ==================================================
# HARDWARE POLLING
# ==================================================

@app.get("/hardware/latest/{device_id}/{sensor_type}")
def get_latest_reading(device_id: str, sensor_type: str):
    result = hardware_tool.get_latest(device_id, sensor_type)
    if not result:
        raise HTTPException(status_code=404, detail="No data found")
    return result


@app.get("/hardware/readings/{device_id}/{sensor_type}")
def get_readings_history(device_id: str, sensor_type: str, n: int = 100):
    """Return last N readings for a device/sensor pair. Used for live graphs."""
    readings = hardware_tool.get_last_n(device_id, sensor_type, n)
    if not readings:
        raise HTTPException(status_code=404, detail="No data found")
    return {
        "device_id":   device_id,
        "sensor_type": sensor_type,
        "count":       len(readings),
        "readings":    readings,
    }


# ==================================================
# REPO ENDPOINTS
# ==================================================

@app.post("/repos/{folder_path:path}")
def clone_repo(folder_path: str, body: RepoRequest):
    """Clone a Git repo and index all its files into the specified folder."""
    from backend.tools import repo_tool
    folder = _get_folder_or_404(folder_path)
    return repo_tool.clone_repo(
        folder_id=folder["id"],
        folder_name=folder_path,
        repo_url=body.repo_url,
        branch=body.branch,
    )


@app.post("/repos/{repo_id}/sync")
def sync_repo(repo_id: str):
    """Re-pull a previously cloned repo and re-index its files."""
    from backend.tools import repo_tool
    return repo_tool.sync_repo(repo_id)


@app.get("/repos/{folder_path:path}")
def list_repos(folder_path: str):
    """List all repos cloned into a folder."""
    from backend.tools import repo_tool
    folder = _get_folder_or_404(folder_path)
    return repo_tool.list_repos(folder["id"])


@app.delete("/repos/{repo_id}")
def delete_repo(repo_id: str):
    """Delete a repo and all its associated files + embeddings."""
    from backend.tools import repo_tool
    return repo_tool.delete_repo(repo_id)


# ==================================================
# VISION — Image Q&A endpoint (NEW — additive)
# ==================================================

ALLOWED_IMAGE_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"
}


@app.post("/vision")
async def vision_chat(question: str, file: UploadFile = File(...)):
    """
    Accepts an image file + a text question and returns a Gemini Vision analysis.
    This is a NEW endpoint — the existing /chat endpoint is completely unchanged.
    """
    from backend.services.llm import generate_response_with_image

    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type '{content_type}'. Allowed: {sorted(ALLOWED_IMAGE_TYPES)}"
        )

    if not question.strip():
        raise HTTPException(status_code=400, detail="'question' must not be empty.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    answer = generate_response_with_image(
        prompt=question,
        image_bytes=image_bytes,
        mime_type=content_type,
    )

    return {
        "type": "vision",
        "question": question,
        "answer": answer,
        "filename": file.filename,
    }