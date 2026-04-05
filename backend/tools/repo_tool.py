"""
backend/tools/repo_tool.py

Git repository integration tool for SEIS.

Functions
---------
clone_repo(folder_id, folder_name, repo_url, branch)
    Clone a public Git repo, filter files, upload to Supabase Storage,
    insert file metadata, index embeddings, and record the repo in DB.

sync_repo(repo_id)
    Re-pull the latest commits, delete old embeddings, re-upload and
    re-index all files, then update last_synced in the repos table.

list_repos(folder_id)
    Query the repos table for all repos belonging to a folder.

delete_repo(repo_id)
    Delete all Storage objects, files rows, embeddings rows, and
    finally the repo row itself.

Storage layout
--------------
  seis-files/{folder_name}/repos/{repo_name}/{relative_filepath}

DB tables used
--------------
  repos (id, folder_id, name, repo_url, branch, last_synced)
  files (id, folder_id, name, storage_path, size_bytes)
  embeddings (id, folder_id, file_id, chunk_text, embedding)
"""

import os
import tempfile
import shutil
import datetime

import git  # gitpython

from fastapi import HTTPException
from backend.services.supabase_client import supabase, BUCKET
from backend.tools import rag_tool


# -------------------- CONSTANTS --------------------

SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", "dist",
    "build", ".next", "venv", "env",
}

ALLOWED_EXTENSIONS = {
    ".py", ".c", ".cpp", ".h", ".hpp", ".java", ".asm", ".s",
    ".txt", ".md", ".pdf", ".js", ".ts", ".jsx", ".tsx",
}

MAX_FILE_BYTES  = 1 * 1024 * 1024    # 1 MB per file
MAX_TOTAL_BYTES = 50 * 1024 * 1024   # 50 MB total


# -------------------- INTERNAL HELPERS --------------------

def _collect_files(repo_dir: str) -> list[tuple[str, str]]:
    """
    Walk the cloned repo directory and return (abs_path, rel_path) tuples
    for every file that passes the extension and size filters.
    Raises HTTPException(413) if the total size exceeds MAX_TOTAL_BYTES.
    """
    results = []
    total_bytes = 0

    for dirpath, dirnames, filenames in os.walk(repo_dir):
        # Prune skipped directories in-place so os.walk won't descend into them
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]

        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in ALLOWED_EXTENSIONS:
                continue

            abs_path = os.path.join(dirpath, fname)
            size = os.path.getsize(abs_path)

            if size > MAX_FILE_BYTES:
                continue   # skip oversized individual file

            total_bytes += size
            if total_bytes > MAX_TOTAL_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=(
                        "Repository exceeds the 50 MB limit. "
                        f"Indexed {len(results)} file(s) before the limit was reached."
                    )
                )

            rel_path = os.path.relpath(abs_path, repo_dir).replace("\\", "/")
            results.append((abs_path, rel_path))

    return results


def _upload_and_index_files(
    folder_id: str,
    folder_name: str,
    repo_name: str,
    file_tuples: list[tuple[str, str]],
) -> list[str]:
    """
    Upload each file to Storage and insert a `files` row.
    Returns a list of inserted file IDs.
    """
    file_ids = []

    for abs_path, rel_path in file_tuples:
        storage_path = f"{folder_name}/repos/{repo_name}/{rel_path}"
        filename     = os.path.basename(abs_path)

        with open(abs_path, "rb") as fh:
            content = fh.read()

        # Upload to Storage (upsert)
        try:
            supabase.storage.from_(BUCKET).upload(
                path=storage_path,
                file=content,
                file_options={
                    "upsert": "true",
                    "content-type": "application/octet-stream",
                },
            )
        except Exception as exc:
            # Non-fatal: skip this file if Storage upload fails
            continue

        # Insert/upsert files row
        try:
            existing = (
                supabase.table("files")
                .select("id")
                .eq("folder_id", folder_id)
                .eq("storage_path", storage_path)
                .execute()
            )
            if existing.data:
                file_id = existing.data[0]["id"]
                supabase.table("files").update({
                    "size_bytes": len(content),
                }).eq("id", file_id).execute()
            else:
                row = supabase.table("files").insert({
                    "folder_id":    folder_id,
                    "name":         filename,
                    "storage_path": storage_path,
                    "size_bytes":   len(content),
                }).execute()
                file_id = row.data[0]["id"]
        except Exception:
            continue

        file_ids.append(file_id)

        # Index embeddings for this file
        try:
            rag_tool.index_file(folder_id, file_id, storage_path, filename)
        except Exception:
            pass   # indexing failure is non-fatal

    return file_ids


def _delete_repo_files_from_storage_and_db(repo_id: str, folder_name: str, repo_name: str):
    """
    Delete all Storage objects and DB rows (files + embeddings) associated
    with the given repo.  Called by delete_repo() and the re-sync path.
    """
    storage_prefix = f"{folder_name}/repos/{repo_name}"

    # List and delete Storage objects
    try:
        items = supabase.storage.from_(BUCKET).list(storage_prefix)
        paths = [f"{storage_prefix}/{i['name']}" for i in (items or []) if i.get("name")]
        if paths:
            supabase.storage.from_(BUCKET).remove(paths)
    except Exception:
        pass

    # Find all file IDs for this repo prefix so we can wipe embeddings
    try:
        files_resp = (
            supabase.table("files")
            .select("id")
            .like("storage_path", f"{storage_prefix}/%")
            .execute()
        )
        for f in files_resp.data or []:
            rag_tool.delete_embeddings_for_file(f["id"])

        # Delete file rows
        supabase.table("files").delete().like(
            "storage_path", f"{storage_prefix}/%"
        ).execute()
    except Exception:
        pass


# -------------------- PUBLIC API --------------------

def clone_repo(folder_id: str, folder_name: str, repo_url: str, branch: str = "main"):
    """
    Clone the given Git repo, filter valid files, upload to Storage,
    index embeddings, and record the repo in the `repos` table.

    Returns a summary dict with repo_id and file count.
    """
    repo_name = repo_url.rstrip("/").split("/")[-1].removesuffix(".git")

    tmpdir = tempfile.mkdtemp(prefix="seis_repo_")
    try:
        # Clone
        try:
            git.Repo.clone_from(repo_url, tmpdir, branch=branch, depth=1)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to clone repository: {exc}"
            )

        # Collect valid files (raises 413 if > 50 MB)
        file_tuples = _collect_files(tmpdir)

        # Upload + index
        file_ids = _upload_and_index_files(
            folder_id, folder_name, repo_name, file_tuples
        )

        # Insert repos row
        now = datetime.datetime.utcnow().isoformat()
        try:
            resp = supabase.table("repos").insert({
                "folder_id":   folder_id,
                "name":        repo_name,
                "repo_url":    repo_url,
                "branch":      branch,
                "last_synced": now,
            }).execute()
            repo_id = resp.data[0]["id"] if resp.data else None
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Database unavailable: {exc}"
            )

    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    return {
        "message":    "Repository cloned and indexed",
        "repo_id":    repo_id,
        "repo_name":  repo_name,
        "file_count": len(file_ids),
    }


def sync_repo(repo_id: str):
    """
    Re-pull latest changes for an existing repo and re-index all files.
    """
    # Fetch repo record
    try:
        resp = (
            supabase.table("repos")
            .select("id, folder_id, name, repo_url, branch")
            .eq("id", repo_id)
            .single()
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    if not resp.data:
        raise HTTPException(status_code=404, detail="Repo not found")

    repo = resp.data

    # Fetch folder name
    try:
        folder_resp = (
            supabase.table("folders")
            .select("name")
            .eq("id", repo["folder_id"])
            .single()
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    folder_name = folder_resp.data["name"]

    # Delete old files + embeddings from Storage and DB
    _delete_repo_files_from_storage_and_db(repo_id, folder_name, repo["name"])

    # Re-clone
    tmpdir = tempfile.mkdtemp(prefix="seis_sync_")
    try:
        try:
            git.Repo.clone_from(repo["repo_url"], tmpdir, branch=repo["branch"], depth=1)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to re-clone: {exc}")

        file_tuples = _collect_files(tmpdir)
        file_ids    = _upload_and_index_files(
            repo["folder_id"], folder_name, repo["name"], file_tuples
        )
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    # Update last_synced
    now = datetime.datetime.utcnow().isoformat()
    try:
        supabase.table("repos").update({"last_synced": now}).eq("id", repo_id).execute()
    except Exception:
        pass

    return {
        "message":    "Repository synced and re-indexed",
        "repo_id":    repo_id,
        "file_count": len(file_ids),
    }


def list_repos(folder_id: str):
    """Return all repos associated with a folder."""
    try:
        resp = (
            supabase.table("repos")
            .select("id, name, repo_url, branch, last_synced")
            .eq("folder_id", folder_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    return {"repos": resp.data or []}


def delete_repo(repo_id: str):
    """
    Delete a repo and all its associated Storage objects, files, and embeddings.
    """
    # Fetch repo record for Storage cleanup
    try:
        resp = (
            supabase.table("repos")
            .select("id, folder_id, name")
            .eq("id", repo_id)
            .single()
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    if not resp.data:
        raise HTTPException(status_code=404, detail="Repo not found")

    repo = resp.data

    # Get folder name for Storage prefix
    try:
        folder_resp = (
            supabase.table("folders")
            .select("name")
            .eq("id", repo["folder_id"])
            .single()
            .execute()
        )
        folder_name = folder_resp.data["name"] if folder_resp.data else ""
    except Exception:
        folder_name = ""

    # Delete Storage + files + embeddings
    if folder_name:
        _delete_repo_files_from_storage_and_db(repo_id, folder_name, repo["name"])

    # Delete repo row
    try:
        supabase.table("repos").delete().eq("id", repo_id).execute()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    return {"message": "Repository deleted", "repo_id": repo_id}
