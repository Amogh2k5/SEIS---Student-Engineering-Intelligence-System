/**
 * lib/api.ts
 * ──────────────────────────────────────────────────────────────
 * Typed API client for the SEIS FastAPI backend.
 * Base URL is read from NEXT_PUBLIC_API_URL (set in .env.local).
 * Falls back to http://localhost:8000 for local development.
 * ──────────────────────────────────────────────────────────────
 */

const BASE_URL =
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

/**
 * Encode a folder path for use in a URL, preserving "/" separators.
 * encodeURIComponent would turn "TEST1/Experiments" into "TEST1%2FExperiments",
 * which breaks FastAPI's {folder_path:path} router. This encodes each segment
 * individually so slashes stay as literal path separators.
 */
function encodePath(folderPath: string): string {
    return folderPath.split("/").map(encodeURIComponent).join("/");
}

// ================================================================
// SHARED HELPER
// ================================================================

async function request<T>(
    path: string,
    init?: RequestInit
): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();
    const isBodyMethod = ["POST", "PUT", "PATCH"].includes(method);

    const mergedHeaders: Record<string, string> = {};
    if (init?.headers) {
        if (init.headers instanceof Headers) {
            init.headers.forEach((value, key) => { mergedHeaders[key] = value; });
        } else if (Array.isArray(init.headers)) {
            init.headers.forEach(([key, value]) => { mergedHeaders[key] = value; });
        } else {
            Object.assign(mergedHeaders, init.headers);
        }
    }

    if (isBodyMethod && !mergedHeaders["Content-Type"] && !mergedHeaders["content-type"]) {
        mergedHeaders["Content-Type"] = "application/json";
    }

    const res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: mergedHeaders,
    });

    if (!res.ok) {
        let detail = res.statusText;
        try {
            const body = await res.json();
            detail = body?.detail ?? body?.error ?? detail;
        } catch {
            // ignore parse error — keep statusText
        }
        throw new Error(`SEIS API ${res.status} on ${method} ${path}: ${detail}`);
    }

    return res.json() as Promise<T>;
}

// ================================================================
// TYPE DEFINITIONS
// ================================================================

/** A project folder entry returned by GET /folders */
export interface Folder {
    folder: string;
    file_count: number;
}

/** An individual file entry returned by GET /folders/{folder}/files */
export interface FileItem {
    name: string;
    path: string;
    size_bytes: number;
}

// ── Chat ─────────────────────────────────────────────────────────

/**
 * Request body for POST /chat.
 * All fields are optional at the type level — the backend validates
 * contextually based on the resolved mode.
 */
export interface ChatRequest {
    /** Routing mode.
     *  Accepted values:
     *  - null / omitted          → AUTO (LLM planner decides)
     *  - "document" | "code" | "hardware"  → legacy direct / same as FORCED
     *  - "FORCED:document" | "FORCED:code" | "FORCED:hardware"
     *  - "RESTRICTED:document_tools" | "RESTRICTED:code_tools" | "RESTRICTED:hardware_tools"
     */
    mode?: string | null;

    /** Carry across turns to bias folder selection toward the last-used project. */
    session_id?: string | null;

    // ── Document ──────────────────────────────────────────────────
    /** User's natural language question. Required for document/hardware modes. */
    question?: string | null;
    /** Pin the RAG query to a specific folder. Omit to auto-select best match. */
    folder?: string | null;

    // ── Code ──────────────────────────────────────────────────────
    /** Code to be fixed. Its presence deterministically triggers code-fix mode. */
    code?: string | null;
    /** Error log / stack trace accompanying the code. */
    error_log?: string | null;
    /** Programming language hint ("python", "c", "java", etc.). */
    language?: string | null;
    /** "fix" (default) or "generate". */
    task?: "fix" | "generate" | null;
    /** Code generation instruction. Its presence deterministically triggers generate mode. */
    instruction?: string | null;

    // ── Hardware ──────────────────────────────────────────────────
    /** Device identifier for explicit hardware mode. */
    device_id?: string | null;
    /** Sensor type identifier for explicit hardware mode. */
    sensor_type?: string | null;
}

/** Successful document-mode response */
export interface DocumentChatResponse {
    type: "document";
    folder_used: string;
    answer: string;
    sources?: { label: string; score: number }[];
}

/** Successful code-mode response */
export interface CodeChatResponse {
    type: "code";
    task: "fix" | "generate";
    language: string;
    code: string;
    explanation: string;
    /** Present only when the LLM output couldn't be parsed as JSON. */
    raw_output?: string;
}

/** Successful hardware-mode response */
export interface HardwareChatResponse {
    type: "hardware";
    device_id: string;
    sensor_type: string;
    analysis: string;
}

/** Returned when the router needs clarification (low confidence or ambiguous query) */
export interface ClarificationResponse {
    clarification_needed: true;
    answer: string;
    /** Only present on RESTRICTED mode violations */
    suggested_modes?: string[];
}

/** Returned on validation or routing errors */
export interface ErrorResponse {
    error: string;
    clarification_needed?: boolean;
    suggested_modes?: string[];
}

/** Union of all possible /chat response shapes */
export type ChatResponse =
    | DocumentChatResponse
    | CodeChatResponse
    | HardwareChatResponse
    | ClarificationResponse
    | ErrorResponse;

export interface ChatHistoryEntry {
    id: number;
    created_at: string;
    session_id: string;
    role: "user" | "assistant";
    message: string;
}

export async function getChatHistory(session_id: string): Promise<ChatHistoryEntry[]> {
    return request<ChatHistoryEntry[]>(`/chat/history/${encodeURIComponent(session_id)}`);
}

// ── Hardware data ─────────────────────────────────────────────────

/** Body for POST /hardware/data */
export interface SensorData {
    device_id: string;
    sensor_type: string;
    value: number;
    /** Unix timestamp in seconds. Defaults to server time if omitted. */
    timestamp?: number | null;
}

/** A single sensor reading (value + unix timestamp) */
export interface Reading {
    value: number;
    timestamp: number;
}

/** Response from GET /hardware/readings/{device_id}/{sensor_type} */
export interface ReadingsHistoryResponse {
    device_id: string;
    sensor_type: string;
    count: number;
    readings: Reading[];
}

// ================================================================
// FOLDER ENDPOINTS
// ================================================================

/** GET /folders — list all project folders with file counts. */
export async function getFolders(): Promise<Folder[]> {
    const data = await request<{ folders: Folder[] }>("/folders");
    return data.folders;
}

/** POST /folders/{name} — create a new project folder. */
export async function createFolder(
    name: string
): Promise<{ message: string; folder: string }> {
    return request(`/folders/${encodePath(name)}`, { method: "POST" });
}

/** DELETE /folders/{name} — delete a project folder and all its contents. */
export async function deleteFolder(
    name: string
): Promise<{ message: string; folder: string }> {
    return request(`/folders/${encodePath(name)}`, { method: "DELETE" });
}

// ================================================================
// FILE ENDPOINTS
// ================================================================

/** GET /folders/{folder}/files — list all user files inside a folder. */
export async function getFiles(folder: string): Promise<FileItem[]> {
    const data = await request<{ folder: string; files: FileItem[] }>(
        `/folders/${encodePath(folder)}/files`
    );
    return data.files;
}

/**
 * DELETE /folders/{folder}/files/{filename}
 * Deletes a single file and clears the folder's FAISS index.
 * Returns null if the file was not found (404), throws on other errors.
 */
export async function deleteFile(
    folder: string,
    filename: string
): Promise<{ message: string } | null> {
    const res = await fetch(
        `${BASE_URL}/folders/${encodePath(folder)}/files/${encodeURIComponent(filename)}`,
        { method: "DELETE" }
    );

    if (res.status === 404) return null;

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
            `SEIS API error ${res.status}: ${body?.detail ?? res.statusText}`
        );
    }

    return res.json();
}

/**
 * POST /upload/{folder} — upload a file into a project folder.
 * Accepts a browser File object directly; sends as multipart/form-data.
 * Clears the folder's FAISS index automatically on the backend.
 */
export async function uploadFile(
    folder: string,
    file: File
): Promise<{ message: string; folder: string; filename: string }> {
    const form = new FormData();
    form.append("file", file);

    const res = await fetch(
        `${BASE_URL}/upload/${encodePath(folder)}`,
        { method: "POST", body: form }
        // Note: do NOT set Content-Type header — browser sets correct multipart boundary
    );

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
            `Upload failed ${res.status}: ${body?.detail ?? res.statusText}`
        );
    }

    return res.json();
}

/**
 * POST /folders/{folder}/reindex
 * Force-clears the FAISS index so it rebuilds on the next chat query.
 * Useful as a manual escape hatch if the index gets stuck.
 */
export async function reindexFolder(
    folder: string
): Promise<{ message: string; folder: string }> {
    return request(`/folders/${encodePath(folder)}/reindex`, {
        method: "POST",
    });
}

// ================================================================
// CHAT ENDPOINT
// ================================================================

/**
 * POST /chat — main orchestrated chat endpoint.
 * Routes to document, code, or hardware tools based on `mode` and payload.
 */
export async function sendChat(chatRequest: ChatRequest): Promise<ChatResponse> {
    return request<ChatResponse>("/chat", {
        method: "POST",
        body: JSON.stringify(chatRequest),
    });
}

// ================================================================
// HARDWARE ENDPOINTS
// ================================================================

/**
 * POST /hardware/data — ingest a sensor reading into the in-memory store.
 * Note: data is lost on server restart (no persistence layer).
 */
export async function postSensorData(
    data: SensorData
): Promise<{ status: string }> {
    return request("/hardware/data", {
        method: "POST",
        body: JSON.stringify(data),
    });
}

/**
 * GET /hardware/latest/{deviceId}/{sensorType}
 * Returns the single most-recent reading for a device/sensor pair.
 * Returns null if no data exists (404).
 */
export async function getLatestReading(
    deviceId: string,
    sensorType: string
): Promise<Reading | null> {
    const res = await fetch(
        `${BASE_URL}/hardware/latest/${encodeURIComponent(deviceId)}/${encodeURIComponent(sensorType)}`
    );

    if (res.status === 404) return null;

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
            `SEIS API error ${res.status}: ${body?.detail ?? res.statusText}`
        );
    }

    return res.json();
}

/**
 * GET /hardware/readings/{deviceId}/{sensorType}?n={n}
 * Returns the last N readings for a device/sensor pair (default n=100).
 * Returns null if no data exists (404).
 */
export async function getReadingsHistory(
    deviceId: string,
    sensorType: string,
    n: number = 100
): Promise<ReadingsHistoryResponse | null> {
    const res = await fetch(
        `${BASE_URL}/hardware/readings/${encodeURIComponent(deviceId)}/${encodeURIComponent(sensorType)}?n=${n}`
    );

    if (res.status === 404) return null;

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
            `SEIS API error ${res.status}: ${body?.detail ?? res.statusText}`
        );
    }

    return res.json();
}

// ================================================================
// VISION ENDPOINT  (NEW — additive, does not affect existing calls)
// ================================================================

/** Response shape returned by POST /vision */
export interface VisionChatResponse {
    type: "vision";
    question: string;
    answer: string;
    filename: string;
}

/**
 * POST /vision — Send an image file + text question to Gemini Vision.
 * Uses multipart/form-data. The existing sendChat() function is unchanged.
 */
export async function sendVisionChat(
    question: string,
    imageFile: File
): Promise<VisionChatResponse> {
    const form = new FormData();
    form.append("file", imageFile);

    const url = `${BASE_URL}/vision?question=${encodeURIComponent(question)}`;

    const res = await fetch(url, { method: "POST", body: form });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
            `Vision API error ${res.status}: ${body?.detail ?? res.statusText}`
        );
    }

    return res.json() as Promise<VisionChatResponse>;
}

// ================================================================
// HARDWARE DETECTION (NEW)
// ================================================================

export interface DetectedDevice {
    port: string;
    device: string;
    nodeId: number | null;
    sensors: string[];
}

export interface HardwareDetectResponse {
    status: "success" | "error";
    devices?: DetectedDevice[];
    error?: string;
}

/**
 * GET /hardware/detect
 * Scans serial ports for active devices and returns a list.
 */
export async function detectDevices(): Promise<HardwareDetectResponse> {
    return request<HardwareDetectResponse>("/hardware/detect");
}

export interface TranscribeResponse {
    text: string;
    error?: string;
}

/**
 * POST /hardware/transcribe
 * Sends an audio blob to the backend for transcription via Gemini 1.5 Flash.
 */
export async function transcribeAudio(blob: Blob): Promise<TranscribeResponse> {
    const formData = new FormData();
    formData.append("file", blob, "audio_chunk.webm");

    // We use a custom fetch here instead of the 'request' helper 
    // because FormData requires the browser to set the boundary 
    // itself (meaning we can't manually set 'Content-Type: application/json').
    const res = await fetch(`${BASE_URL}/hardware/transcribe`, {
        method: "POST",
        body: formData,
    });

    if (!res.ok) {
        throw new Error(`Transcription API error: ${res.status}`);
    }

    return res.json() as Promise<TranscribeResponse>;
}
