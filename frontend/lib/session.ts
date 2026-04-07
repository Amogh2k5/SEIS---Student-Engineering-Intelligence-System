/**
 * lib/session.ts
 * ─────────────────────────────────────────────────────────────
 * Browser-session identity for SEIS chat continuity.
 *
 * Uses localStorage with namespace isolation so different
 * workspaces/projects can retain their chat histories across browser restarts.
 *
 * All sessionStorage access is guarded for SSR safety — Next.js
 * renders pages on the server where `window` does not exist.
 * ─────────────────────────────────────────────────────────────
 */

const SESSION_KEY = "seis_session_id";

/**
 * Returns the current session ID, creating and persisting one if
 * none exists yet.
 *
 * Safe to call during SSR — returns null on the server so callers
 * can omit `session_id` from the /chat request body when running
 * server-side.
 */
export function getSessionId(namespace: string = "global"): string | null {
    if (typeof window === "undefined") return null;

    const nsKey = `${SESSION_KEY}_${namespace}`;
    const existing = localStorage.getItem(nsKey);
    if (existing) return existing;

    const id = crypto.randomUUID();
    localStorage.setItem(nsKey, id);
    return id;
}

/**
 * Removes the session ID from sessionStorage.
 * Call this to force a fresh session (e.g. on explicit user sign-out
 * or when the user switches projects and you want to reset context).
 */
export function clearSession(namespace: string = "global"): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem(`${SESSION_KEY}_${namespace}`);
}
