"use client";

import React, {
    useState,
    useRef,
    useEffect,
    useCallback,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, type Transition } from "framer-motion";
import { Sparkles, X, Send, Loader2, Mic, MicOff } from "lucide-react";
import { sendChat, transcribeAudio, type ChatResponse } from "@/lib/api";
import { getSessionId } from "@/lib/session";

// ================================================================
// TYPES
// ================================================================

type Role = "user" | "assistant";

interface Message {
    id: string;
    role: Role;
    text: string;
    tool?: string;
}

// ================================================================
// ANIMATION CONSTANTS
// ================================================================

const SPRING: Transition = { type: "spring", stiffness: 300, damping: 28 };

const panelVariants = {
    hidden: { x: 340, opacity: 0 },
    visible: { x: 0, opacity: 1 },
    exit: { x: 340, opacity: 0 },
};

const panelTransition: Transition = { type: "spring", stiffness: 260, damping: 30 };

const msgVariants = {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0 },
};

const msgTransition: Transition = { duration: 0.2 };

// ================================================================
// RESPONSE HELPERS
// ================================================================

function extractAnswer(res: ChatResponse): { text: string; tool: string } {
    if ("error" in res) {
        return { text: `Error: ${res.error}`, tool: "error" };
    }
    if ("clarification_needed" in res) {
        return { text: res.answer, tool: "clarification" };
    }
    if (res.type === "document") return { text: res.answer, tool: "document" };
    if (res.type === "code")
        return {
            text: `\`\`\`${res.language}\n${res.code}\n\`\`\`\n${res.explanation}`,
            tool: "code",
        };
    if (res.type === "hardware") return { text: res.analysis, tool: "hardware" };
    return { text: "No response received.", tool: "unknown" };
}

const TOOL_LABELS: Record<string, string> = {
    document: "📄 Document",
    code: "💻 Code",
    hardware: "🔌 Hardware",
    clarification: "❓ Clarifying",
    error: "⚠ Error",
    unknown: "—",
};

// ================================================================
// TOOL BADGE
// ================================================================

function ToolBadge({ tool }: { tool: string }) {
    if (!tool || tool === "unknown") return null;
    return (
        <span style={{ fontSize: "10px", color: "#9CA3AF", fontWeight: 500, letterSpacing: "0.04em", marginTop: "2px", display: "block" }}>
            {TOOL_LABELS[tool] ?? tool}
        </span>
    );
}

// ================================================================
// GLOBAL ASSISTANT — renders the panel via portal to avoid z/layout issues
// ================================================================

export default function GlobalAssistant() {
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [listening, setListening] = useState(false);
    const [micStatus, setMicStatus] = useState<"active" | "processing" | "limited">("active");
    
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    
    // ── Resilient Mic Refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const consecutiveFailuresRef = useRef(0);
    const isBackoffRef = useRef(false);

    // Portal mount guard — only render portal after hydration
    useEffect(() => { setMounted(true); }, []);

    // Auto-scroll on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, sending]);

    // Focus input when panel opens
    useEffect(() => {
        if (open) setTimeout(() => inputRef.current?.focus(), 350);
    }, [open]);

    // Close on outside click — only listen when open
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                // Also don't close if clicking the trigger button (handled by toggle)
                setOpen(false);
            }
        };
        const timer = setTimeout(() => {
            document.addEventListener("mousedown", handler);
        }, 150);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("mousedown", handler);
        };
    }, [open]);

    // ── Robust Mic handler — Uses MediaRecorder + Backend Gemini STT
    const stopRecording = useCallback(() => {
        console.log(`[${new Date().toLocaleTimeString()}] [Mic] Stopping recorder...`);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        setListening(false);
        setMicStatus("active");
    }, []);

    const processChunk = useCallback(async (blob: Blob, isRetry = false) => {
        if (isBackoffRef.current) return;

        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] [STT] Sending chunk (${(blob.size / 1024).toFixed(1)} KB)...`);
        
        setMicStatus("processing");

        try {
            const res = await transcribeAudio(blob);
            
            if (res.error) {
                throw new Error(res.error);
            }

            consecutiveFailuresRef.current = 0;
            setMicStatus("active");

            if (res.text) {
                console.log(`[${timestamp}] [STT] Success: "${res.text}"`);
                setInput((prev) => {
                    const next = prev ? prev + " " + res.text : res.text;
                    // Max length safeguard — trim to last 1000 chars if it grows too large
                    return next.length > 1000 ? next.slice(-1000) : next;
                });
            }
        } catch (err) {
            console.error(`[${timestamp}] [STT] Failure (try ${isRetry ? 2 : 1}):`, err);

            if (!isRetry) {
                // Lightweight retry after 500ms
                console.log(`[${timestamp}] [STT] Retrying in 500ms...`);
                setTimeout(() => processChunk(blob, true), 500);
                return;
            }

            // If retry also fails
            consecutiveFailuresRef.current += 1;
            console.log(`[${timestamp}] [STT] Consecutive failures: ${consecutiveFailuresRef.current}`);

            if (consecutiveFailuresRef.current >= 3) {
                console.warn(`[${timestamp}] [STT] Entering 8s backoff mode...`);
                isBackoffRef.current = true;
                setMicStatus("limited");
                setTimeout(() => {
                    isBackoffRef.current = false;
                    consecutiveFailuresRef.current = 0;
                    if (mediaRecorderRef.current?.state === "recording") {
                        setMicStatus("active");
                    }
                    console.log(`[${new Date().toLocaleTimeString()}] [STT] Backoff ended.`);
                }, 8000);
            } else {
                setMicStatus("active");
            }
        }
    }, []);

    const startRecording = useCallback(async () => {
        try {
            console.log(`[${new Date().toLocaleTimeString()}] [Mic] Requesting permissions...`);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
            mediaRecorderRef.current = recorder;
            
            consecutiveFailuresRef.current = 0;
            isBackoffRef.current = false;

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    void processChunk(e.data);
                }
            };

            recorder.onstart = () => {
                setListening(true);
                setMicStatus("active");
            };

            // Start slicing audio every 4 seconds (delta chunks)
            recorder.start(4000);
        } catch (err) {
            console.error("[Mic] Failed to start recording:", err);
            alert("Could not access microphone. Check permissions.");
        }
    }, [processChunk]);

    const handleMic = useCallback(() => {
        if (listening) {
            stopRecording();
        } else {
            void startRecording();
        }
    }, [listening, startRecording, stopRecording]);

    // Stop mic when panel closes
    useEffect(() => {
        if (!open && listening) {
            stopRecording();
        }
    }, [open, listening, stopRecording]);

    const handleSend = useCallback(async () => {
        const text = input.trim();
        if (!text || sending) return;

        // Stop mic if active
        if (listening) {
            stopRecording();
        }

        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: "user",
            text,
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setSending(true);

        try {
            const res = await sendChat({
                question: text,
                mode: null,
                session_id: getSessionId(),
            });

            const { text: answerText, tool } = extractAnswer(res);
            const assistantMsg: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                text: answerText,
                tool,
            };
            setMessages((prev) => [...prev, assistantMsg]);
        } catch (err) {
            setMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    text: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
                    tool: "error",
                },
            ]);
        } finally {
            setSending(false);
        }
    }, [input, sending, listening]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        }
    };

    // ── Sliding panel (rendered via portal to escape header stacking context)
    const panel = (
        <AnimatePresence>
            {open && (
                <motion.div
                    ref={panelRef}
                    key="assistant-panel"
                    variants={panelVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={panelTransition}
                    style={{
                        position: "fixed",
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: "320px",
                        zIndex: 9999,
                        display: "flex",
                        flexDirection: "column",
                        background: "rgba(255,255,255,0.97)",
                        backdropFilter: "blur(20px)",
                        WebkitBackdropFilter: "blur(20px)",
                        borderLeft: "1.5px solid #DBEAFE",
                        boxShadow: "-8px 0 40px rgba(37,99,235,0.08), -2px 0 12px rgba(0,0,0,0.06)",
                    }}
                >
                    {/* Header */}
                    <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "16px 20px", borderBottom: "1.5px solid #EFF6FF",
                        background: "#EFF6FF", flexShrink: 0,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <Sparkles size={14} style={{ color: "#2563EB" }} />
                            <h2 style={{ fontSize: "14px", fontWeight: 700, color: "#1D4ED8", margin: 0 }}>
                                AI Assistant
                            </h2>
                        </div>
                        <button
                            onClick={() => setOpen(false)}
                            style={{
                                display: "flex", alignItems: "center", justifyContent: "center",
                                width: "28px", height: "28px", borderRadius: "8px",
                                background: "#FFFFFF", border: "1.5px solid #DBEAFE",
                                cursor: "pointer", transition: "border-color 0.15s",
                            }}
                            aria-label="Close assistant"
                        >
                            <X size={13} style={{ color: "#6B7280" }} />
                        </button>
                    </div>

                    {/* Message history */}
                    <div style={{
                        flex: 1, overflowY: "auto", padding: "16px",
                        display: "flex", flexDirection: "column", gap: "10px",
                    }}>
                        {messages.length === 0 && (
                            <div style={{ textAlign: "center", padding: "32px 16px" }}>
                                <div style={{
                                    width: "48px", height: "48px", borderRadius: "12px",
                                    background: "linear-gradient(135deg, #EFF6FF, #DBEAFE)",
                                    border: "1.5px solid #BFDBFE", display: "flex",
                                    alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
                                }}>
                                    <Sparkles size={20} style={{ color: "#2563EB" }} />
                                </div>
                                <p style={{ fontSize: "13px", color: "#6B7280", lineHeight: 1.6, margin: 0 }}>
                                    Ask anything — I can search your documents, generate code, or analyze sensor data.
                                </p>
                            </div>
                        )}

                        <AnimatePresence initial={false}>
                            {messages.map((msg) => (
                                <motion.div
                                    key={msg.id}
                                    variants={msgVariants}
                                    initial="hidden"
                                    animate="visible"
                                    transition={msgTransition}
                                    style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}
                                >
                                    <div style={{
                                        maxWidth: "85%", padding: "9px 13px", borderRadius: "12px",
                                        fontSize: "13px", lineHeight: 1.55, whiteSpace: "pre-wrap",
                                        ...(msg.role === "user"
                                            ? { background: "#2563EB", color: "#FFFFFF", borderBottomRightRadius: "4px" }
                                            : { background: "#F8FAFC", border: "1.5px solid #DBEAFE", color: "#1F2937", borderBottomLeftRadius: "4px" }
                                        ),
                                    }}>
                                        {msg.text}
                                    </div>
                                    {msg.role === "assistant" && msg.tool && <ToolBadge tool={msg.tool} />}
                                </motion.div>
                            ))}
                        </AnimatePresence>

                        {/* Sending indicator */}
                        {sending && (
                            <motion.div variants={msgVariants} initial="hidden" animate="visible" transition={msgTransition}
                                style={{ display: "flex", alignItems: "flex-start" }}>
                                <div style={{
                                    padding: "9px 13px", borderRadius: "12px", borderBottomLeftRadius: "4px",
                                    background: "#F8FAFC", border: "1.5px solid #DBEAFE",
                                    display: "flex", alignItems: "center", gap: "8px",
                                }}>
                                    <Loader2 size={13} style={{ color: "#2563EB", animation: "spin 1s linear infinite" }} />
                                    <span style={{ fontSize: "12px", color: "#6B7280" }}>Thinking…</span>
                                </div>
                            </motion.div>
                        )}

                        <div ref={bottomRef} />
                    </div>

                    {/* Input bar */}
                    <div style={{
                        padding: "12px 16px", borderTop: "1.5px solid #EFF6FF",
                        background: "#FFFFFF", flexShrink: 0,
                    }}>
                        {/* Mic status */}
                        {listening && (
                            <div style={{
                                display: "flex", alignItems: "center", gap: "6px",
                                marginBottom: "8px", padding: "4px 10px", borderRadius: "6px",
                                background: micStatus === "limited" ? "#FFFBEB" : micStatus === "processing" ? "#F0FDF4" : "#FEF2F2",
                                border: `1px solid ${micStatus === "limited" ? "#FDE68A" : micStatus === "processing" ? "#BBF7D0" : "#FECACA"}`,
                            }}>
                                <div style={{
                                    width: "6px", height: "6px", borderRadius: "50%",
                                    background: micStatus === "limited" ? "#F59E0B" : micStatus === "processing" ? "#10B981" : "#EF4444",
                                    animation: micStatus === "processing" ? "pulse 0.8s ease infinite" : "none",
                                }} />
                                <span style={{ fontSize: "11px", color: micStatus === "limited" ? "#B45309" : micStatus === "processing" ? "#047857" : "#DC2626", fontWeight: 500 }}>
                                    {micStatus === "limited" ? "API Quota Limited (Backoff)..." : micStatus === "processing" ? "Processing audio..." : "Listening... tap mic to stop"}
                                </span>
                            </div>
                        )}
                        <div style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            padding: "8px 12px", borderRadius: "12px",
                            background: "#F8FAFC", border: "1.5px solid #DBEAFE",
                            transition: "border-color 0.2s",
                        }}>
                            {/* Mic button */}
                            <motion.button
                                whileHover={{ scale: 1.08 }}
                                whileTap={{ scale: 0.92 }}
                                transition={SPRING}
                                onClick={handleMic}
                                disabled={sending}
                                style={{
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    width: "28px", height: "28px", borderRadius: "8px", border: "none",
                                    background: listening ? "#FEF2F2" : "#EFF6FF",
                                    color: listening ? "#EF4444" : "#6B7280",
                                    cursor: "pointer", flexShrink: 0,
                                }}
                                aria-label={listening ? "Stop recording" : "Speak"}
                            >
                                {listening ? <MicOff size={13} /> : <Mic size={13} />}
                            </motion.button>

                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={listening ? (micStatus === "processing" ? "Processing..." : "Listening...") : "Ask anything…"}
                                disabled={sending}
                                style={{
                                    flex: 1, background: "transparent", border: "none",
                                    fontSize: "13px", color: "#111827", outline: "none",
                                    opacity: sending ? 0.5 : 1,
                                }}
                            />
                            <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                transition={SPRING}
                                onClick={handleSend}
                                disabled={!input.trim() || sending}
                                style={{
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    width: "30px", height: "30px", borderRadius: "8px",
                                    background: input.trim() && !sending ? "#2563EB" : "#E5E7EB",
                                    border: "none", cursor: input.trim() && !sending ? "pointer" : "not-allowed",
                                    transition: "background 0.2s", flexShrink: 0,
                                    opacity: !input.trim() || sending ? 0.4 : 1,
                                }}
                                aria-label="Send"
                            >
                                <Send size={13} style={{ color: "#FFFFFF" }} />
                            </motion.button>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    return (
        <>
            {/* Trigger button — sits inline in the header */}
            <motion.button
                whileHover={{ scale: 1.05, y: -1 }}
                whileTap={{ scale: 0.95 }}
                transition={SPRING}
                onClick={() => setOpen((o) => !o)}
                style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "34px", height: "34px", borderRadius: "9px",
                    background: open ? "#EFF6FF" : "#F8FAFC",
                    border: `1.5px solid ${open ? "#BFDBFE" : "#E5E7EB"}`,
                    cursor: "pointer",
                    transition: "background 0.2s, border-color 0.2s",
                    boxShadow: open ? "0 0 0 3px rgba(37,99,235,0.08)" : "none",
                }}
                aria-label="Open AI Assistant"
            >
                <Sparkles size={16} style={{ color: open ? "#2563EB" : "#6B7280", transition: "color 0.2s" }} />
            </motion.button>

            {/* Panel rendered via portal — escapes header's stacking context */}
            {mounted && createPortal(panel, document.body)}
        </>
    );
}
