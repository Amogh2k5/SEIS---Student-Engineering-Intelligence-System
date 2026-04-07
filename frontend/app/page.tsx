"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, type Variants, type Transition } from "framer-motion";
import {
    FolderOpen, Plus, Loader2, Send, Sparkles, Trash2, FilePlus,
    FolderPlus, ChevronRight, Mic, MicOff, ImagePlus, X, Search,
    Zap, FileText, Code2, Cpu, Settings,
} from "lucide-react";
import {
    getFolders, createFolder, deleteFolder, uploadFile, sendChat,
    sendVisionChat,
    type Folder, type ChatResponse,
} from "@/lib/api";
import { getSessionId } from "@/lib/session";

// ================================================================
// ANIMATION CONFIG
// ================================================================
const SPRING: Transition = { type: "spring", stiffness: 150, damping: 20, mass: 1.1 };
const FADE: Transition = { duration: 0.4, ease: [0.16, 1, 0.3, 1] };

const fadeUp: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
};

const stagger: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.06 } },
};

// ================================================================
// TYPES
// ================================================================
type Role = "user" | "assistant";
type Mode = "document" | "code" | "hardware";

interface Message {
    id: string;
    role: Role;
    text: string;
    tool?: string;
    imageName?: string;
}

interface DropdownState {
    folder: string;
    right: number;
    top?: number;
    bottom?: number;
}

// ================================================================
// CHAT HELPERS
// ================================================================
function extractAnswer(res: ChatResponse): { text: string; tool: string; sources?: { label: string; score: number }[] } {
    if ("error" in res) return { text: `Error: ${res.error}`, tool: "error" };
    if ("clarification_needed" in res) return { text: res.answer, tool: "clarification" };
    if (res.type === "document") return { text: res.answer, tool: "document", sources: res.sources };
    if (res.type === "code")
        return {
            text: `\`\`\`${res.language}\n${res.code}\n\`\`\`\n${res.explanation}`,
            tool: "code",
        };
    if (res.type === "hardware") return { text: res.analysis, tool: "hardware" };
    return { text: "No response received.", tool: "unknown" };
}

const MODE_TO_API: Record<Mode, string | null> = {
    document: "document",
    code: "code",
    hardware: "hardware",
};

// ================================================================
// SMALL REUSABLE COMPONENTS
// ================================================================

function ToolBadge({ tool }: { tool: string }) {
    const map: Record<string, { label: string; color: string; bg: string }> = {
        document: { label: "Document", color: "#3730A3", bg: "#E0E7FF" },
        code: { label: "Code", color: "#065F46", bg: "#D1FAE5" },
        hardware: { label: "Hardware", color: "#92400E", bg: "#FEF3C7" },
        clarification: { label: "Clarifying", color: "#5B21B6", bg: "#EDE9FE" },
        error: { label: "Error", color: "#991B1B", bg: "#FEE2E2" },
        vision: { label: "Vision", color: "#3730A3", bg: "#EFF6FF" },
    };
    const m = map[tool];
    if (!m) return null;
    return (
        <span
            style={{
                display: "inline-flex", alignItems: "center", padding: "2px 8px",
                borderRadius: "9999px", fontSize: "10px", fontWeight: 600,
                letterSpacing: "0.06em", textTransform: "uppercase",
                color: m.color, backgroundColor: m.bg, marginTop: "4px",
            }}
        >
            {m.label}
        </span>
    );
}

function TypingDots() {
    return (
        <div style={{ display: "flex", gap: "4px", padding: "14px 16px", alignItems: "center" }}>
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    animate={{ y: [0, -5, 0], opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }}
                    style={{ width: 6, height: 6, borderRadius: "50%", background: "#818CF8" }}
                />
            ))}
        </div>
    );
}

// ================================================================
// SIDEBAR
// ================================================================
interface SidebarProps {
    folders: Folder[];
    loading: boolean;
    activeFolder: string | null;
    onSelectFolder: (f: string) => void;
    onCreateFolder: () => void;
    onDropdownOpen: (s: DropdownState) => void;
    actionLoading: boolean;
}

function Sidebar({ folders, loading, activeFolder, onSelectFolder, onCreateFolder, onDropdownOpen, actionLoading }: SidebarProps) {
    const chevronRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const openMenu = (e: React.MouseEvent, folder: string) => {
        e.stopPropagation();
        const ref = chevronRefs.current[folder];
        if (!ref) return;
        const rect = ref.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow >= 180) {
            onDropdownOpen({ folder, right: window.innerWidth - rect.right, top: rect.bottom + 6 });
        } else {
            onDropdownOpen({ folder, right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.top + 6 });
        }
    };

    return (
        <aside
            style={{
                width: "240px",
                minWidth: "240px",
                background: "rgba(255,255,255,0.38)",
                backdropFilter: "blur(28px) saturate(150%)",
                WebkitBackdropFilter: "blur(28px) saturate(150%)",
                borderRight: "1px solid rgba(255,255,255,0.20)",
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
            }}
        >
            {/* Search bar */}
            <div style={{ padding: "16px 12px 8px" }}>
                <div
                    style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        padding: "7px 14px", borderRadius: "9999px",
                        background: "rgba(255,255,255,0.55)",
                        border: "1px solid rgba(255,255,255,0.28)",
                        boxShadow: "0 2px 8px rgba(79,70,229,0.06)",
                    }}
                >
                    <Search size={13} style={{ color: "#6366F1", flexShrink: 0 }} />
                    <input
                        type="text"
                        placeholder="Search projects…"
                        style={{
                            flex: 1, background: "transparent", border: "none", outline: "none",
                            fontSize: "12.5px", color: "#0f172a",
                        }}
                    />
                </div>
            </div>

            {/* Projects section */}
            <div style={{ padding: "8px 12px 4px", flex: 1, overflowY: "auto" }}>
                <div
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        marginBottom: "6px", padding: "0 4px",
                    }}
                >
                    <span style={{ fontSize: "10.5px", fontWeight: 600, color: "#6366F1", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                        📁 Projects
                    </span>
                    <button
                        onClick={onCreateFolder}
                        disabled={actionLoading}
                        style={{
                            display: "flex", alignItems: "center", justifyContent: "center",
                            width: "20px", height: "20px", borderRadius: "5px",
                            background: "transparent", border: "none", cursor: "pointer",
                            color: "#818CF8", transition: "all 0.15s",
                        }}
                        title="New project"
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.6)"; (e.currentTarget as HTMLElement).style.color = "#3730A3"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#818CF8"; }}
                    >
                        <Plus size={12} />
                    </button>
                </div>

                {/* Loading skeletons */}
                {loading && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        {[1, 2, 3].map((i) => (
                            <div key={i} style={{ height: "36px", borderRadius: "12px", background: "rgba(224,231,255,0.4)", animation: "pulse 1.5s infinite" }} />
                        ))}
                    </div>
                )}

                {/* Empty state */}
                {!loading && folders.length === 0 && (
                    <div style={{ padding: "24px 8px", textAlign: "center" }}>
                        <FolderOpen size={24} style={{ color: "#C7D2FE", margin: "0 auto 8px" }} />
                        <p style={{ fontSize: "12px", color: "#6366F1" }}>No projects yet</p>
                        <button
                            onClick={onCreateFolder}
                            style={{ marginTop: "8px", fontSize: "12px", color: "#4F46E5", background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}
                        >
                            + Create one
                        </button>
                    </div>
                )}

                {/* Folder list */}
                <AnimatePresence>
                    {!loading && folders.map((f) => {
                        const isActive = f.folder === activeFolder;
                        return (
                            <motion.div
                                key={f.folder}
                                initial={{ opacity: 0, x: -6 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -6 }}
                                transition={FADE}
                            >
                                <div
                                    onClick={() => onSelectFolder(f.folder)}
                                    className={`sidebar-item ${isActive ? "active" : ""}`}
                                    style={{ marginBottom: "2px", position: "relative" }}
                                    role="button"
                                >
                                    <FolderOpen size={14} style={{ color: isActive ? "#4F46E5" : "#818CF8", flexShrink: 0 }} />
                                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {f.folder}
                                    </span>
                                    <span style={{ fontSize: "10px", color: isActive ? "#818CF8" : "#C7D2FE" }}>
                                        {f.file_count}
                                    </span>
                                    <button
                                        ref={(el) => { chevronRefs.current[f.folder] = el; }}
                                        onClick={(e) => openMenu(e, f.folder)}
                                        style={{
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            width: "18px", height: "18px", borderRadius: "4px",
                                            background: "transparent", border: "none", cursor: "pointer",
                                            color: "#C7D2FE", opacity: 0, transition: "opacity 0.15s",
                                        }}
                                        className="folder-menu-btn"
                                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#6366F1"; }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#C7D2FE"; }}
                                        aria-label={`Open menu for ${f.folder}`}
                                    >
                                        <ChevronRight size={11} />
                                    </button>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {/* User profile */}
            <div
                style={{
                    padding: "12px 14px",
                    borderTop: "1px solid rgba(255,255,255,0.20)",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    background: "rgba(255,255,255,0.28)",
                }}
            >
                <div
                    style={{
                        width: "28px", height: "28px", borderRadius: "50%",
                        background: "linear-gradient(135deg, #E0E7FF, #C7D2FE)",
                        border: "1.5px solid rgba(129,140,248,0.5)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "11px", fontWeight: 700, color: "#3730A3", flexShrink: 0,
                    }}
                >A</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>amogh</div>
                    <div style={{ fontSize: "10px", color: "#6366F1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>amogh@seis.dev</div>
                </div>
                <Settings size={13} style={{ color: "#818CF8", cursor: "pointer", flexShrink: 0 }} />
            </div>
        </aside>
    );
}

// ================================================================
// DASHBOARD HOME (NO FOLDER SELECTED)
// ================================================================
function DashboardHome({ folders, onSelectFolder, onCreateFolder, onDeleteFolder }: { folders: Folder[], onSelectFolder: (f: string) => void, onCreateFolder: () => void, onDeleteFolder: (f: string) => void }) {
    return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "transparent", overflowY: "auto", padding: "40px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", marginBottom: "8px", letterSpacing: "-0.02em" }}>Command Center</h1>
            <p style={{ fontSize: "14px", color: "#334155", marginBottom: "32px" }}>Select a project to start analyzing code, documents, and hardware data.</p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
                <motion.div
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    transition={SPRING}
                    onClick={onCreateFolder}
                    style={{
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                        height: "140px", borderRadius: "24px",
                        border: "2px dashed rgba(129,140,248,0.4)",
                        background: "rgba(255,255,255,0.35)",
                        backdropFilter: "blur(16px)",
                        cursor: "pointer", gap: "12px", transition: "all 0.2s"
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.6)"; (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.5)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(129,140,248,0.4)"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.35)"; }}
                >
                    <Plus size={24} style={{ color: "#818CF8" }} />
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>New Project</span>
                </motion.div>

                {folders.map(f => (
                    <motion.div
                        key={f.folder}
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        transition={SPRING}
                        className="seis-card"
                        style={{
                            display: "flex", flexDirection: "column", padding: "20px", height: "140px",
                            cursor: "pointer", transition: "box-shadow 0.2s", position: "relative"
                        }}
                    >
                        {/* Delete button */}
                        <div style={{ position: "absolute", top: "12px", right: "12px", zIndex: 10 }}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteFolder(f.folder);
                                }}
                                style={{
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    width: "28px", height: "28px", borderRadius: "8px",
                                    background: "rgba(254,242,242,0.7)",
                                    backdropFilter: "blur(8px)",
                                    border: "none",
                                    color: "#DC2626", cursor: "pointer",
                                    opacity: 0, transition: "opacity 0.2s, background 0.2s",
                                }}
                                className="dashboard-card-delete"
                                aria-label="Delete project"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>

                        <div onClick={() => onSelectFolder(f.folder)} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                            <div style={{ width: "36px", height: "36px", borderRadius: "12px", background: "rgba(224,231,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
                                <FolderOpen size={18} style={{ color: "#4F46E5" }} />
                            </div>
                            <span style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.folder}</span>
                            <span style={{ fontSize: "12px", color: "#334155" }}>{f.file_count} files indexed</span>
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}

// ================================================================
// CHAT PANEL (CENTER)
// ================================================================
interface ChatPanelCenterProps {
    activeFolder: string | null;
    mode: Mode;
    onModeChange: (m: Mode) => void;
    onLastTool: (t: string) => void;
    onAttachedImage: (name: string | null) => void;
    onConfidence?: (sources: { label: string; score: number }[]) => void;
    triggerAnalysis?: number;
}

function ChatPanelCenter({ activeFolder, mode, onModeChange, onLastTool, onAttachedImage, onConfidence, triggerAnalysis }: ChatPanelCenterProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const [listening, setListening] = useState(false);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const recognitionRef = useRef<SpeechRecognition | null>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, sending]);

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
        onAttachedImage(file.name);
        inputRef.current?.focus();
    };

    const clearImage = useCallback(() => {
        setImageFile(null);
        if (imagePreview) URL.revokeObjectURL(imagePreview);
        setImagePreview(null);
        onAttachedImage(null);
        if (imageInputRef.current) imageInputRef.current.value = "";
    }, [imagePreview, onAttachedImage]);

    const handleMic = useCallback(() => {
        const SR = (window as typeof window & { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition
            || (window as typeof window & { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;
        if (!SR) { alert("Speech recognition not supported. Try Chrome or Edge."); return; }
        if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
        const rec = new SR();
        rec.lang = "en-US";
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onstart = () => setListening(true);
        rec.onend = () => setListening(false);
        rec.onerror = () => setListening(false);
        rec.onresult = (event: SpeechRecognitionEvent) => {
            const t = event.results[0][0].transcript;
            setInput((prev) => prev ? prev + " " + t : t);
            inputRef.current?.focus();
        };
        recognitionRef.current = rec;
        rec.start();
    }, [listening]);

    const handleSend = useCallback(async (overrideText?: string | React.MouseEvent) => {
        const text = (typeof overrideText === "string" ? overrideText : input).trim();
        if (!text && !imageFile) return;
        if (sending) return;

        if (imageFile) {
            const question = text || "What is in this image? Describe it in detail.";
            const imgName = imageFile.name;
            const userMsg: Message = {
                id: crypto.randomUUID(), role: "user",
                text: `📎 ${imgName}${text ? " — " + text : ""}`,
                imageName: imgName,
            };
            setMessages((prev) => [...prev, userMsg]);
            setInput("");
            clearImage();
            setSending(true);
            try {
                const res = await sendVisionChat(question, imageFile);
                onLastTool("vision");
                setMessages((prev) => [...prev, {
                    id: crypto.randomUUID(), role: "assistant",
                    text: res.answer, tool: "vision",
                }]);
            } catch (err) {
                setMessages((prev) => [...prev, {
                    id: crypto.randomUUID(), role: "assistant",
                    text: err instanceof Error ? err.message : String(err), tool: "error",
                }]);
            } finally { setSending(false); }
            return;
        }

        const userMsg: Message = { id: crypto.randomUUID(), role: "user", text };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setSending(true);
        try {
            const res = await sendChat({
                question: text,
                mode: MODE_TO_API[mode],
                folder: activeFolder ?? undefined,
                session_id: getSessionId(),
            });
            const { text: ansText, tool, sources } = extractAnswer(res);
            onLastTool(tool);
            if (onConfidence && sources) { onConfidence(sources); }
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", text: ansText, tool }]);
        } catch (err) {
            setMessages((prev) => [...prev, {
                id: crypto.randomUUID(), role: "assistant",
                text: err instanceof Error ? err.message : String(err), tool: "error",
            }]);
        } finally { setSending(false); }
    }, [input, sending, imageFile, mode, activeFolder, clearImage, onLastTool]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
    };

    const MODE_CONFIG: Record<Mode, { icon: React.ReactNode; label: string }> = {
        document: { icon: <FileText size={13} />, label: "Document" },
        code: { icon: <Code2 size={13} />, label: "Code" },
        hardware: { icon: <Cpu size={13} />, label: "Hardware" },
    };

    return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "rgba(255,255,255,0.28)", backdropFilter: "blur(20px)", minWidth: 0, height: "100%" }}>
            {/* Top bar */}
            <div
                style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 24px",
                    borderBottom: "1px solid rgba(255,255,255,0.20)",
                    background: "rgba(255,255,255,0.35)",
                    backdropFilter: "blur(20px)",
                    flexShrink: 0,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "12px", color: "#6366F1" }}>Projects</span>
                    <ChevronRight size={12} style={{ color: "#C7D2FE" }} />
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                        {activeFolder ?? "All Projects"}
                    </span>
                    <span className="seis-badge">
                        {MODE_CONFIG[mode].icon}
                        {` ${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode`}
                    </span>
                </div>

                {/* Mode tabs */}
                <div style={{ display: "flex", gap: "4px", background: "rgba(224,231,255,0.45)", padding: "3px", borderRadius: "9999px" }}>
                    {(["document", "code", "hardware"] as Mode[]).map((m) => (
                        <button
                            key={m}
                            onClick={() => onModeChange(m)}
                            className={`mode-tab ${mode === m ? "active" : ""}`}
                        >
                            {m.charAt(0).toUpperCase() + m.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", minHeight: 0 }}>
                {/* Empty state */}
                {messages.length === 0 && !sending && (
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "16px", textAlign: "center" }}
                    >
                        <div
                            style={{
                                width: "52px", height: "52px", borderRadius: "24px",
                                background: "rgba(255,255,255,0.55)",
                                backdropFilter: "blur(16px)",
                                border: "1px solid rgba(255,255,255,0.3)",
                                boxShadow: "0 0 20px rgba(79,70,229,0.15)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                        >
                            <Sparkles size={22} style={{ color: "#4F46E5" }} />
                        </div>
                        <div>
                            <p style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>
                                Ask anything about {activeFolder ?? "your projects"}
                            </p>
                            <p style={{ fontSize: "12px", color: "#334155", marginTop: "4px" }}>
                                Search documents, analyze circuits, generate code, or query sensors
                            </p>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
                            {["Summarize the datasheet", "Write an Arduino sketch", "Analyze sensor reading"].map((s) => (
                                <button
                                    key={s}
                                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                                    style={{
                                        padding: "6px 14px", borderRadius: "9999px", fontSize: "12px",
                                        fontWeight: 500, color: "#4338CA",
                                        background: "rgba(255,255,255,0.55)",
                                        backdropFilter: "blur(12px)",
                                        border: "1px solid rgba(129,140,248,0.35)", cursor: "pointer",
                                        transition: "all 0.15s",
                                    }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.7)"; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.55)"; }}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}

                {/* Message bubbles */}
                <AnimatePresence initial={false}>
                    {messages.map((msg) => (
                        <motion.div
                            key={msg.id}
                            variants={fadeUp}
                            initial="hidden"
                            animate="visible"
                            transition={FADE}
                            style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}
                        >
                            {msg.role === "user" ? (
                                <div
                                    style={{
                                        maxWidth: "75%", padding: "10px 16px",
                                        background: "linear-gradient(135deg, #3730A3, #4F46E5)",
                                        color: "#FFFFFF", borderRadius: "20px 20px 4px 20px",
                                        fontSize: "14px", lineHeight: "1.55",
                                        boxShadow: "0 4px 16px rgba(79,70,229,0.40)",
                                    }}
                                >
                                    {msg.text}
                                </div>
                            ) : (
                                <div>
                                    <div
                                        style={{
                                            maxWidth: "680px", padding: "14px 18px",
                                            background: "rgba(255,255,255,0.55)",
                                            backdropFilter: "blur(16px)",
                                            border: "1px solid rgba(255,255,255,0.28)",
                                            borderRadius: "4px 20px 20px 20px",
                                            fontSize: "14px", lineHeight: "1.65", color: "#0f172a",
                                            whiteSpace: "pre-wrap",
                                            boxShadow: "0 2px 12px rgba(79,70,229,0.08)",
                                        }}
                                    >
                                        {msg.text}
                                    </div>
                                    {msg.tool && <ToolBadge tool={msg.tool} />}
                                </div>
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>

                {/* Typing indicator */}
                {sending && (
                    <motion.div variants={fadeUp} initial="hidden" animate="visible" transition={FADE} style={{ display: "flex" }}>
                        <div style={{
                            background: "rgba(255,255,255,0.55)", backdropFilter: "blur(16px)",
                            border: "1px solid rgba(255,255,255,0.28)", borderRadius: "4px 20px 20px 20px",
                        }}>
                            <TypingDots />
                        </div>
                    </motion.div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Image preview strip */}
            {imagePreview && (
                <div style={{ padding: "8px 24px 0", display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ position: "relative" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={imagePreview} alt="Attached" style={{ height: "48px", width: "auto", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.3)", objectFit: "cover" }} />
                        <button
                            onClick={clearImage}
                            style={{
                                position: "absolute", top: -6, right: -6,
                                width: "16px", height: "16px", borderRadius: "50%",
                                background: "#EF4444", border: "none", cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                color: "#fff",
                            }}
                        >
                            <X size={9} />
                        </button>
                    </div>
                    <span style={{ fontSize: "11px", color: "#6366F1" }}>{imageFile?.name}</span>
                </div>
            )}

            {/* Floating input bar */}
            <div style={{ padding: "12px 24px 20px", flexShrink: 0 }}>
                <div className="chat-input-bar" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 8px 8px 16px" }}>
                    <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        style={{ display: "none" }}
                        onChange={handleImageSelect}
                    />

                    <button
                        onClick={() => imageInputRef.current?.click()}
                        disabled={sending}
                        title="Attach image (circuit photo, diagram, etc.)"
                        style={{
                            display: "flex", alignItems: "center", justifyContent: "center",
                            width: "30px", height: "30px", borderRadius: "9999px",
                            background: imageFile ? "rgba(199,210,254,0.7)" : "transparent",
                            border: imageFile ? "1px solid rgba(129,140,248,0.5)" : "1px solid transparent",
                            cursor: "pointer", color: imageFile ? "#4F46E5" : "#818CF8",
                            transition: "all 0.15s", flexShrink: 0,
                        }}
                        onMouseEnter={(e) => { if (!imageFile) { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.5)"; (e.currentTarget as HTMLElement).style.color = "#4F46E5"; } }}
                        onMouseLeave={(e) => { if (!imageFile) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#818CF8"; } }}
                    >
                        <ImagePlus size={15} />
                    </button>

                    <motion.button
                        animate={listening ? { scale: [1, 1.15, 1] } : {}}
                        transition={listening ? { repeat: Infinity, duration: 0.8 } : SPRING}
                        onClick={handleMic}
                        disabled={sending}
                        title={listening ? "Listening… click to stop" : "Speak your message"}
                        style={{
                            display: "flex", alignItems: "center", justifyContent: "center",
                            width: "30px", height: "30px", borderRadius: "9999px",
                            background: listening ? "rgba(254,226,226,0.7)" : "transparent",
                            border: listening ? "1px solid #FECACA" : "1px solid transparent",
                            cursor: "pointer", color: listening ? "#DC2626" : "#818CF8",
                            transition: "all 0.15s", flexShrink: 0,
                        }}
                        onMouseEnter={(e) => { if (!listening) { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.5)"; (e.currentTarget as HTMLElement).style.color = "#4F46E5"; } }}
                        onMouseLeave={(e) => { if (!listening) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#818CF8"; } }}
                    >
                        {listening ? <MicOff size={15} /> : <Mic size={15} />}
                    </motion.button>

                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={listening ? "Listening…" : imageFile ? "Ask about this image…" : "Ask anything about this project…"}
                        disabled={sending}
                        style={{
                            flex: 1, background: "transparent", border: "none", outline: "none",
                            fontSize: "14px", color: "#0f172a",
                        }}
                    />

                    <button
                        onClick={() => void handleSend()}
                        disabled={(!input.trim() && !imageFile) || sending}
                        className="send-btn"
                        aria-label="Send message"
                    >
                        <Send size={15} />
                    </button>
                </div>
            </div>
        </div>
    );
}

// ================================================================
// INSPECTOR PANEL (RIGHT)
// ================================================================
interface InspectorProps {
    activeFolder: string | null;
    lastTool: string | null;
    attachedImage: string | null;
    messageCount: number;
    lastConfidence?: { label: string; score: number }[] | null;
    onRunAnalysis?: () => void;
}

function Inspector({ activeFolder, lastTool, attachedImage, messageCount, lastConfidence, onRunAnalysis }: InspectorProps) {
    const toolColors: Record<string, string> = {
        document: "#3730A3", code: "#059669", hardware: "#D97706",
        vision: "#7C3AED", error: "#DC2626",
    };
    const color = lastTool ? (toolColors[lastTool] ?? "#6366F1") : "#818CF8";

    return (
        <aside
            style={{
                width: "288px",
                minWidth: "288px",
                background: "rgba(255,255,255,0.38)",
                backdropFilter: "blur(28px) saturate(150%)",
                WebkitBackdropFilter: "blur(28px) saturate(150%)",
                borderLeft: "1px solid rgba(255,255,255,0.20)",
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
            }}
        >
            <div style={{ padding: "16px 16px 8px", borderBottom: "1px solid rgba(255,255,255,0.20)" }}>
                <h3 style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    Inspector
                </h3>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
                {/* Attached image */}
                {attachedImage && (
                    <div className="seis-card" style={{ padding: "12px", marginBottom: "10px" }}>
                        <p style={{ fontSize: "10px", fontWeight: 600, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                            Active Media
                        </p>
                        <div style={{ background: "rgba(224,231,255,0.4)", borderRadius: "12px", padding: "24px", textAlign: "center", marginBottom: "8px" }}>
                            <ImagePlus size={24} style={{ color: "#C7D2FE", margin: "0 auto" }} />
                        </div>
                        <p style={{ fontSize: "11px", color: "#0f172a", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            📎 {attachedImage}
                        </p>
                    </div>
                )}

                {/* AI Confidence */}
                {lastConfidence && lastConfidence.length > 0 ? (
                    <div className="seis-card" style={{ padding: "12px", marginBottom: "10px" }}>
                        <p style={{ fontSize: "10px", fontWeight: 600, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>
                            Intelligence Confidence
                        </p>
                        {lastConfidence.map((src, i) => (
                            <div key={i} style={{ marginBottom: "10px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                    <span style={{ fontSize: "11.5px", color: "#1e293b", fontWeight: 500 }}>{src.label}</span>
                                    <span style={{ fontSize: "11px", color: "#4F46E5", fontWeight: 600 }}>{Math.round(src.score * 100)}%</span>
                                </div>
                                <div className="conf-bar-track">
                                    <motion.div
                                        className="conf-bar-fill"
                                        initial={{ width: 0 }}
                                        animate={{ width: `${Math.min(100, src.score * 100)}%` }}
                                        transition={{ duration: 0.8, ease: "easeOut" }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="seis-card" style={{ padding: "12px", marginBottom: "10px" }}>
                        <p style={{ fontSize: "10px", fontWeight: 600, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>
                            Intelligence Confidence
                        </p>
                        <div style={{ padding: "12px", background: "rgba(224,231,255,0.3)", borderRadius: "12px", textAlign: "center", border: "1px dashed rgba(129,140,248,0.4)" }}>
                            <span style={{ fontSize: "10.5px", color: "#334155" }}>Standby for retrieval...</span>
                        </div>
                    </div>
                )}

                {/* Session context */}
                <div className="seis-card" style={{ padding: "12px", marginBottom: "10px" }}>
                    <p style={{ fontSize: "10px", fontWeight: 600, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>
                        Session Context
                    </p>
                    {[
                        { label: "Project", value: activeFolder ?? "Global" },
                        { label: "Messages", value: String(messageCount) },
                        { label: "Last Tool", value: lastTool ?? "—" },
                        { label: "Status", value: "Ready" },
                    ].map(({ label, value }) => (
                        <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                            <span style={{ fontSize: "11.5px", color: "#334155" }}>{label}</span>
                            <span style={{ fontSize: "11.5px", color: label === "Last Tool" ? color : "#0f172a", fontWeight: 500 }}>
                                {value}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Quick actions */}
                <div className="seis-card" style={{ padding: "12px" }}>
                    <p style={{ fontSize: "10px", fontWeight: 600, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                        Quick Actions
                    </p>
                    {[
                        { icon: <Zap size={12} />, label: "Run Analysis", action: onRunAnalysis },
                        { icon: <FileText size={12} />, label: "Export Session", action: () => alert("Session exported to PDF.") },
                    ].map(({ icon, label, action }) => (
                        <button
                            key={label}
                            onClick={action}
                            style={{
                                display: "flex", alignItems: "center", gap: "8px",
                                width: "100%", padding: "7px 10px", borderRadius: "12px",
                                background: "transparent",
                                border: "1px solid rgba(129,140,248,0.28)",
                                cursor: "pointer", fontSize: "12px", color: "#1e293b",
                                fontWeight: 500, marginBottom: "6px", transition: "all 0.15s",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.5)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.45)"; (e.currentTarget as HTMLElement).style.color = "#3730A3"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(129,140,248,0.28)"; (e.currentTarget as HTMLElement).style.color = "#1e293b"; }}
                        >
                            <span style={{ color: "#4F46E5" }}>{icon}</span>
                            {label}
                        </button>
                    ))}
                </div>
            </div>
        </aside>
    );
}

// ================================================================
// DROPDOWN MENU
// ================================================================
interface DropdownMenuProps {
    dropdown: DropdownState;
    onClose: () => void;
    onUpload: (folder: string, file: File) => Promise<void>;
    onAddSubfolder: (folder: string) => Promise<void>;
    onDelete: (folder: string) => Promise<void>;
}

function DropdownMenu({ dropdown, onClose, onUpload, onAddSubfolder, onDelete }: DropdownMenuProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (!(e.target as HTMLElement).closest("[data-dropdown]")) onClose();
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [onClose]);

    return (
        <div
            data-dropdown="true"
            style={{
                position: "fixed", zIndex: 100,
                top: dropdown.top !== undefined ? `${dropdown.top}px` : undefined,
                bottom: dropdown.bottom !== undefined ? `${dropdown.bottom}px` : undefined,
                right: `${dropdown.right}px`,
            }}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -6 }}
                transition={FADE}
                style={{
                    width: "160px", borderRadius: "16px",
                    border: "1px solid rgba(255,255,255,0.28)",
                    background: "rgba(255,255,255,0.72)",
                    backdropFilter: "blur(24px) saturate(150%)",
                    boxShadow: "0 12px 40px rgba(79,70,229,0.14)", overflow: "hidden",
                }}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    style={{ display: "none" }}
                    accept=".txt,.py,.c,.cpp,.h,.pdf,.docx"
                    onChange={async (e) => { const f = e.target.files?.[0]; if (f) await onUpload(dropdown.folder, f); onClose(); }}
                />
                {[
                    { icon: <FilePlus size={13} />, label: "Add File", action: () => fileInputRef.current?.click() },
                    { icon: <FolderPlus size={13} />, label: "Add Subfolder", action: async () => { await onAddSubfolder(dropdown.folder); onClose(); } },
                ].map(({ icon, label, action }) => (
                    <button
                        key={label}
                        onClick={action}
                        style={{
                            display: "flex", alignItems: "center", gap: "10px",
                            width: "100%", padding: "9px 14px",
                            background: "transparent", border: "none", cursor: "pointer",
                            fontSize: "13px", color: "#1e293b", textAlign: "left",
                            transition: "background 0.1s",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.55)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                        <span style={{ color: "#4F46E5" }}>{icon}</span>
                        {label}
                    </button>
                ))}
                <div style={{ height: "1px", background: "rgba(224,231,255,0.6)", margin: "2px 0" }} />
                <button
                    onClick={async () => { await onDelete(dropdown.folder); onClose(); }}
                    style={{
                        display: "flex", alignItems: "center", gap: "10px",
                        width: "100%", padding: "9px 14px",
                        background: "transparent", border: "none", cursor: "pointer",
                        fontSize: "13px", color: "#DC2626", textAlign: "left",
                        transition: "background 0.1s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(254,226,226,0.5)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                    <Trash2 size={13} />
                    Delete
                </button>
            </motion.div>
        </div>
    );
}

// ================================================================
// PAGE
// ================================================================
export default function DashboardPage() {
    const router = useRouter();
    const [folders, setFolders] = useState<Folder[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [dropdown, setDropdown] = useState<DropdownState | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

    const loadFolders = useCallback(async () => {
        try {
            const data = await getFolders();
            setFolders(data);
            setFolders(data);
        } catch (err) {
            console.error("Failed to load folders:", err);
        } finally {
            setLoading(false);
        }
    }, [activeFolder]);

    useEffect(() => { void loadFolders(); }, [loadFolders]);

    const handleCreateFolder = async () => {
        const name = window.prompt("Project name:");
        if (!name?.trim()) return;
        setActionLoading(true);
        try { await createFolder(name.trim()); await loadFolders(); }
        catch (err) { alert(`Could not create project: ${err instanceof Error ? err.message : String(err)}`); }
        finally { setActionLoading(false); }
    };

    const handleUpload = async (folder: string, file: File) => {
        setActionLoading(true);
        try { await uploadFile(folder, file); await loadFolders(); }
        catch (err) { alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`); }
        finally { setActionLoading(false); }
    };

    const handleAddSubfolder = async (parent: string) => {
        const name = window.prompt("Subfolder name:");
        if (!name?.trim()) return;
        setActionLoading(true);
        try { await createFolder(`${parent}/${name.trim()}`); await loadFolders(); }
        catch { alert("Could not create subfolder."); }
        finally { setActionLoading(false); }
    };

    const handleDeleteFolder = async (folder: string) => {
        if (!window.confirm(`Delete "${folder}" and all its files? This cannot be undone.`)) return;
        setActionLoading(true);
        try { await deleteFolder(folder); await loadFolders(); if (activeFolder === folder) setActiveFolder(null); }
        catch { alert("Could not delete project."); }
        finally { setActionLoading(false); }
    };

    const handleSelectFolder = (f: string) => {
        router.push(`/project/${encodeURIComponent(f)}`);
    };

    return (
        <main
            style={{
                display: "flex",
                height: "calc(100svh - 56px)",
                overflow: "hidden",
                background: "transparent",
            }}
        >
            <Sidebar
                folders={folders}
                loading={loading}
                activeFolder={activeFolder}
                onSelectFolder={handleSelectFolder}
                onCreateFolder={handleCreateFolder}
                onDropdownOpen={(s) => setDropdown(s)}
                actionLoading={actionLoading}
            />

            <DashboardHome
                folders={folders}
                onSelectFolder={handleSelectFolder}
                onCreateFolder={handleCreateFolder}
                onDeleteFolder={handleDeleteFolder}
            />

            <AnimatePresence>
                {dropdown && (
                    <DropdownMenu
                        dropdown={dropdown}
                        onClose={() => setDropdown(null)}
                        onUpload={handleUpload}
                        onAddSubfolder={handleAddSubfolder}
                        onDelete={handleDeleteFolder}
                    />
                )}
            </AnimatePresence>
        </main>
    );
}
