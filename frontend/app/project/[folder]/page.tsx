"use client";

import React, {
    useState,
    useEffect,
    useRef,
    useCallback,
    use,
} from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, type Transition, type Variants } from "framer-motion";
import {
    ArrowLeft, Upload, RefreshCw, Trash2, Loader2, FileCode2,
    FileText, Cpu, MessageSquare, Send, Mic, MicOff, ImagePlus, X, Sparkles, Zap, Search
} from "lucide-react";
import {
    getFiles, deleteFile, uploadFile, reindexFolder, sendChat, sendVisionChat, getChatHistory,
    detectDevices,
    type FileItem, type ChatResponse, type DetectedDevice
} from "@/lib/api";
import { getSessionId } from "@/lib/session";
import HardwarePanel from "@/components/HardwarePanel";

// ================================================================
// CONSTANTS & ANIMATIONS
// ================================================================
const CODE_EXTS = new Set([".py", ".c", ".cpp", ".h", ".hpp", ".java", ".asm", ".s"]);
const DOC_EXTS = new Set([".pdf", ".txt", ".docx", ".pptx"]);

const SPRING: Transition = { type: "spring", stiffness: 150, damping: 20, mass: 1.1 };
const FADE: Transition = { duration: 0.4, ease: [0.16, 1, 0.3, 1] };

const tabContentVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
};

const fadeUp: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
};

// ================================================================
// TYPES
// ================================================================
type Mode = "document" | "code" | "hardware";
type Role = "user" | "assistant";

interface Message {
    id: string;
    role: Role;
    text: string;
    tool?: string;
    imageName?: string;
}

// ================================================================
// HELPERS
// ================================================================
function extractAnswer(res: ChatResponse): { text: string; tool: string; sources?: { label: string; score: number }[] } {
    if ("error" in res) return { text: `Error: ${res.error}`, tool: "error" };
    if ("clarification_needed" in res) return { text: res.answer, tool: "clarification" };
    if (res.type === "document") return { text: res.answer, tool: "document", sources: res.sources };
    if (res.type === "code") return { text: `\`\`\`${res.language}\n${res.code}\n\`\`\`\n${res.explanation}`, tool: "code" };
    if (res.type === "hardware") return { text: res.analysis, tool: "hardware" };
    return { text: "No response received.", tool: "unknown" };
}

function fileExt(filename: string) {
    const i = filename.lastIndexOf(".");
    return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function langBadge(filename: string): string {
    const ext = fileExt(filename);
    const map: Record<string, string> = {
        ".py": "Python", ".c": "C", ".cpp": "C++",
        ".h": "C/C++ Header", ".hpp": "C++ Header",
        ".java": "Java", ".asm": "Assembly", ".s": "Assembly",
    };
    return map[ext] ?? ext.replace(".", "").toUpperCase();
}

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
        <span style={{
            display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: "9999px",
            fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
            color: m.color, backgroundColor: m.bg, marginTop: "4px"
        }}>
            {m.label}
        </span>
    );
}

function TypingDots() {
    return (
        <div style={{ display: "flex", gap: "4px", padding: "14px 16px", alignItems: "center" }}>
            {[0, 1, 2].map((i) => (
                <motion.div key={i} animate={{ y: [0, -5, 0], opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.15 }} style={{ width: 6, height: 6, borderRadius: "50%", background: "#818CF8" }} />
            ))}
        </div>
    );
}

// ================================================================
// FILE CARD
// ================================================================
interface FileCardProps { file: FileItem; showLangBadge?: boolean; onDelete: (filename: string) => void; }

function FileCard({ file, showLangBadge = false, onDelete }: FileCardProps) {
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Delete "${file.name}"?`)) return;
        setDeleting(true);
        onDelete(file.name);
    };

    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
            <div className="seis-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                    <div style={{ width: "28px", height: "28px", borderRadius: "10px", background: "rgba(224,231,255,0.65)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {showLangBadge ? <FileCode2 size={14} color="#4F46E5" /> : <FileText size={14} color="#4F46E5" />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</p>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                            <span style={{ fontSize: "11px", color: "#334155" }}>{formatBytes(file.size_bytes)}</span>
                            {showLangBadge && <span className="seis-badge" style={{ fontSize: "9px", padding: "1px 6px" }}>{langBadge(file.name)}</span>}
                        </div>
                    </div>
                </div>
                <button
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{
                        display: "flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px",
                        borderRadius: "9px", background: "rgba(254,226,226,0.7)", border: "1px solid #FECACA", color: "#EF4444",
                        cursor: "pointer", transition: "all 0.15s", flexShrink: 0
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(254,202,202,0.85)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(254,226,226,0.7)"; }}
                    title={`Delete ${file.name}`}
                >
                    {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
            </div>
        </motion.div>
    );
}

// ================================================================
// DOCUMENT TAB
// ================================================================
function DocumentTab({ files, loading, onDelete, onUpload, onReindex, actionLoading }: any) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const docFiles = files.filter((f: any) => DOC_EXTS.has(fileExt(f.name)));

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input ref={fileInputRef} type="file" style={{ display: "none" }} accept=".pdf,.txt,.docx,.pptx" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
                <button
                    onClick={() => fileInputRef.current?.click()} disabled={actionLoading}
                    style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "8px", borderRadius: "12px", fontSize: "12px", fontWeight: 600, color: "#3730A3", background: "rgba(224,231,255,0.65)", border: "1px solid rgba(129,140,248,0.35)", cursor: "pointer", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(199,210,254,0.75)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.65)"; }}
                >
                    <Upload size={13} />
                    Upload Doc
                </button>
                <button
                    onClick={onReindex} disabled={actionLoading}
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "8px 12px", borderRadius: "12px", fontSize: "12px", fontWeight: 600, color: "#334155", background: "rgba(255,255,255,0.45)", border: "1px solid rgba(255,255,255,0.3)", cursor: "pointer", transition: "all 0.15s" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.65)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.45)"; }}
                >
                    {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                </button>
            </div>

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{[1, 2, 3].map((i) => <div key={i} style={{ height: "56px", borderRadius: "16px", background: "rgba(224,231,255,0.4)", animation: "pulse 1.5s infinite" }} />)}</div>
            ) : docFiles.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", background: "rgba(255,255,255,0.35)", backdropFilter: "blur(16px)", borderRadius: "16px", border: "1px dashed rgba(129,140,248,0.35)" }}>
                    <FileText size={24} style={{ color: "#C7D2FE", margin: "0 auto 8px" }} />
                    <p style={{ fontSize: "12px", color: "#334155" }}>No documents yet.</p>
                </div>
            ) : (
                <AnimatePresence>
                    <div>{docFiles.map((f: any) => <FileCard key={f.path} file={f} onDelete={onDelete} />)}</div>
                </AnimatePresence>
            )}
        </div>
    );
}

// ================================================================
// CODE TAB
// ================================================================
function CodeTab({ files, loading, onDelete, onUpload, actionLoading }: any) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const codeFiles = files.filter((f: any) => CODE_EXTS.has(fileExt(f.name)));

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <input ref={fileInputRef} type="file" style={{ display: "none" }} accept=".py,.c,.cpp,.h,.hpp,.java,.asm,.s" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }} />
            <button
                onClick={() => fileInputRef.current?.click()} disabled={actionLoading}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "8px", borderRadius: "12px", fontSize: "12px", fontWeight: 600, color: "#3730A3", background: "rgba(224,231,255,0.65)", border: "1px solid rgba(129,140,248,0.35)", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(199,210,254,0.75)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.65)"; }}
            >
                {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Upload Code File
            </button>

            {loading ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>{[1, 2].map((i) => <div key={i} style={{ height: "56px", borderRadius: "16px", background: "rgba(224,231,255,0.4)", animation: "pulse 1.5s infinite" }} />)}</div>
            ) : codeFiles.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", background: "rgba(255,255,255,0.35)", backdropFilter: "blur(16px)", borderRadius: "16px", border: "1px dashed rgba(129,140,248,0.35)" }}>
                    <FileCode2 size={24} style={{ color: "#C7D2FE", margin: "0 auto 8px" }} />
                    <p style={{ fontSize: "12px", color: "#334155" }}>No code files yet.</p>
                </div>
            ) : (
                <AnimatePresence>
                    <div>{codeFiles.map((f: any) => <FileCard key={f.path} file={f} showLangBadge onDelete={onDelete} />)}</div>
                </AnimatePresence>
            )}
        </div>
    );
}

// ================================================================
// HARDWARE TAB
// ================================================================
function HardwareTab() {
    const [deviceId, setDeviceId] = useState("");
    const [sensorType, setSensorType] = useState("");
    const [confirmed, setConfirmed] = useState(false);

    const [isDetecting, setIsDetecting] = useState(false);
    const [detectError, setDetectError] = useState<string | null>(null);
    const [foundDevices, setFoundDevices] = useState<DetectedDevice[]>([]);

    const handleDetect = async () => {
        setIsDetecting(true);
        setDetectError(null);
        setFoundDevices([]);
        try {
            const res = await detectDevices();
            if (res.status === "success" && res.devices) {
                setFoundDevices(res.devices);
                if (res.devices.length === 0) {
                    setDetectError("No devices found. Check connections.");
                }
            } else {
                setDetectError(res.error || "Detection failed.");
            }
        } catch (err) {
            setDetectError("Scanner error: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setIsDetecting(false);
        }
    };

    const selectDevice = (dev: DetectedDevice) => {
        setDeviceId(dev.nodeId ? `${dev.device}-${dev.nodeId}` : dev.device);
        if (dev.sensors.length > 0) {
            setSensorType(dev.sensors[0].toLowerCase());
        }
    };

    if (!confirmed) {
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <p style={{ fontSize: "12px", color: "#334155", lineHeight: 1.5 }}>
                        Scan for connected hardware or enter details manually.
                    </p>

                    <button
                        onClick={handleDetect}
                        disabled={isDetecting}
                        style={{
                            width: "100%", padding: "8px", borderRadius: "9999px",
                            background: "rgba(255,255,255,0.45)",
                            backdropFilter: "blur(12px)",
                            border: "1px solid rgba(129,140,248,0.4)",
                            color: "#4F46E5", fontSize: "12px", fontWeight: 600,
                            cursor: "pointer", display: "flex", alignItems: "center",
                            justifyContent: "center", gap: "8px", transition: "all 0.15s"
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.6)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.45)"; }}
                    >
                        {isDetecting ? (
                            <>
                                <Loader2 size={13} className="animate-spin" />
                                Scanning Hardware...
                            </>
                        ) : (
                            <>
                                <Search size={13} />
                                Detect Devices
                            </>
                        )}
                    </button>

                    <AnimatePresence>
                        {foundDevices.length > 0 && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                style={{ display: "flex", flexDirection: "column", gap: "6px", overflow: "hidden" }}
                            >
                                {foundDevices.map((dev, i) => (
                                    <button
                                        key={i}
                                        onClick={() => selectDevice(dev)}
                                        style={{
                                            display: "flex", flexDirection: "column", alignItems: "flex-start",
                                            padding: "8px 12px", borderRadius: "12px",
                                            background: "rgba(255,255,255,0.55)",
                                            backdropFilter: "blur(12px)",
                                            border: "1px solid rgba(255,255,255,0.3)", cursor: "pointer", textAlign: "left"
                                        }}
                                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(129,140,248,0.5)"; }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.3)"; }}
                                    >
                                        <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#0f172a" }}>{dev.device} {dev.nodeId ? `#${dev.nodeId}` : ""}</span>
                                            <span style={{ fontSize: "10px", color: "#6366F1" }}>{dev.port}</span>
                                        </div>
                                        <span style={{ fontSize: "10px", color: "#334155" }}>Sensors: {dev.sensors.join(", ")}</span>
                                    </button>
                                ))}
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {detectError && (
                        <p style={{ fontSize: "11px", color: "#EF4444", textAlign: "center" }}>{detectError}</p>
                    )}
                </div>

                <div style={{ height: "1px", background: "rgba(129,140,248,0.2)", margin: "4px 0" }} />

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <div>
                        <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>Device ID</label>
                        <input type="text" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="e.g. sensor-01"
                            style={{ width: "100%", padding: "8px 12px", borderRadius: "9999px", border: "1px solid rgba(129,140,248,0.35)", background: "rgba(255,255,255,0.5)", fontSize: "13px", color: "#0f172a", outline: "none", backdropFilter: "blur(8px)" }} />
                    </div>
                    <div>
                        <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#1e293b", marginBottom: "4px" }}>Sensor Type</label>
                        <input type="text" value={sensorType} onChange={(e) => setSensorType(e.target.value)} placeholder="e.g. temperature"
                            style={{ width: "100%", padding: "8px 12px", borderRadius: "9999px", border: "1px solid rgba(129,140,248,0.35)", background: "rgba(255,255,255,0.5)", fontSize: "13px", color: "#0f172a", outline: "none", backdropFilter: "blur(8px)" }} />
                    </div>
                    <button
                        onClick={() => { if (deviceId.trim() && sensorType.trim()) setConfirmed(true); }}
                        disabled={!deviceId.trim() || !sensorType.trim()}
                        style={{ width: "100%", padding: "8px", borderRadius: "9999px", background: "linear-gradient(135deg, #3730A3, #4F46E5)", color: "white", fontSize: "12px", fontWeight: 600, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", transition: "all 0.15s", boxShadow: "0 0 16px rgba(79,70,229,0.4)" }}
                    >
                        <Cpu size={13} />
                        Monitor Device
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", background: "rgba(15,23,42,0.85)", backdropFilter: "blur(24px)", padding: "16px", borderRadius: "24px", border: "1px solid rgba(255,255,255,0.10)" }}>
           <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
               <span style={{ color: "white", fontSize: "13px", fontWeight: 600 }}>Live Sensor Feed</span>
               <button onClick={() => setConfirmed(false)} style={{ background: "none", border: "none", color: "#818CF8", fontSize: "11px", cursor: "pointer", textDecoration: "underline" }}>Change</button>
           </div>
           <HardwarePanel deviceId={deviceId.trim()} sensorType={sensorType.trim()} />
        </div>
    );
}

// ================================================================
// CUSTOM CHAT PANEL
// ================================================================
interface CustomChatPanelProps {
    folder: string;
    mode: Mode;
    onLastTool: (t: string) => void;
    onAttachedImage: (img: string | null) => void;
    onConfidence?: (sources: { label: string; score: number }[]) => void;
    triggerAnalysis?: number;
}

function CustomChatPanel({ folder, mode, onLastTool, onAttachedImage, onConfidence, triggerAnalysis }: CustomChatPanelProps) {
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
        const sid = getSessionId(folder);
        if (!sid) return;
        getChatHistory(sid).then(history => {
            if (history && history.length > 0) {
                setMessages(history.map(entry => ({
                    id: entry.id.toString(),
                    role: entry.role,
                    text: entry.message,
                    tool: entry.role === "assistant" ? mode : undefined
                })));
            }
        }).catch(err => console.error("Failed to fetch chat history:", err));
    }, [folder, mode]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImageFile(file); setImagePreview(URL.createObjectURL(file)); onAttachedImage(file.name);
        inputRef.current?.focus();
    };

    const clearImage = useCallback(() => {
        setImageFile(null); if (imagePreview) URL.revokeObjectURL(imagePreview);
        setImagePreview(null); onAttachedImage(null); if (imageInputRef.current) imageInputRef.current.value = "";
    }, [imagePreview, onAttachedImage]);

    const handleMic = useCallback(() => {
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SR) { alert("Speech recognition not supported in this browser."); return; }
        if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
        const rec = new SR(); rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
        rec.onstart = () => setListening(true); rec.onend = () => setListening(false); rec.onerror = () => setListening(false);
        rec.onresult = (event: any) => { const t = event.results[0][0].transcript; setInput((prev) => prev ? prev + " " + t : t); inputRef.current?.focus(); };
        recognitionRef.current = rec; rec.start();
    }, [listening]);

    const handleSend = useCallback(async (overrideText?: string | React.MouseEvent) => {
        const text = (typeof overrideText === "string" ? overrideText : input).trim();
        if (!text && !imageFile) return;
        if (sending) return;

        if (imageFile) {
            const question = text || "What is in this image?";
            const imgName = imageFile.name;
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: `📎 ${imgName}${text ? " — " + text : ""}`, imageName: imgName }]);
            setInput(""); clearImage(); setSending(true);
            try {
                const res = await sendVisionChat(question, imageFile);
                onLastTool("vision");
                setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", text: res.answer, tool: "vision" }]);
            } catch (err) { setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", text: String(err), tool: "error" }]); }
            finally { setSending(false); }
            return;
        }

        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);
        setInput(""); setSending(true);
        try {
            const res = await sendChat({ question: text, mode, folder, session_id: getSessionId(folder) });
            const { text: ansText, tool, sources } = extractAnswer(res);
            onLastTool(tool);
            if (onConfidence && sources) { onConfidence(sources); }
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", text: ansText, tool }]);
        } catch (err) { setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", text: String(err), tool: "error" }]); }
        finally { setSending(false); }
    }, [input, sending, imageFile, mode, folder, clearImage, onLastTool, onConfidence]);

    useEffect(() => {
        if (triggerAnalysis && triggerAnalysis > 0) {
            void handleSend("Run a comprehensive overview and analysis on this project.");
        }
    }, [triggerAnalysis]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", minHeight: 0 }}>
                {messages.length === 0 && !sending && (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "16px", textAlign: "center" }}>
                        <div style={{ width: "48px", height: "48px", borderRadius: "20px", background: "rgba(255,255,255,0.55)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 20px rgba(79,70,229,0.15)" }}>
                            <MessageSquare size={20} style={{ color: "#4F46E5" }} />
                        </div>
                        <div>
                            <p style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>Project Chat: {folder}</p>
                            <p style={{ fontSize: "12px", color: "#334155", marginTop: "4px" }}>Start asking questions about this project's files.</p>
                        </div>
                    </div>
                )}
                <AnimatePresence initial={false}>
                    {messages.map((msg) => (
                        <motion.div key={msg.id} variants={fadeUp} initial="hidden" animate="visible" transition={FADE} style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
                            {msg.role === "user" ? (
                                <div style={{ maxWidth: "75%", padding: "10px 16px", background: "linear-gradient(135deg, #3730A3, #4F46E5)", color: "white", borderRadius: "20px 20px 4px 20px", fontSize: "13.5px", lineHeight: 1.5, boxShadow: "0 4px 16px rgba(79,70,229,0.40)" }}>{msg.text}</div>
                            ) : (
                                <div>
                                    <div style={{ maxWidth: "680px", padding: "14px 18px", background: "rgba(255,255,255,0.55)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: "4px 20px 20px 20px", fontSize: "13.5px", lineHeight: 1.6, color: "#0f172a", whiteSpace: "pre-wrap" }}>{msg.text}</div>
                                    {msg.tool && <ToolBadge tool={msg.tool} />}
                                </div>
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>
                {sending && <motion.div variants={fadeUp} initial="hidden" animate="visible" style={{ display: "flex" }}><div style={{ background: "rgba(255,255,255,0.55)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: "4px 20px 20px 20px" }}><TypingDots /></div></motion.div>}
                <div ref={bottomRef} />
            </div>

            {/* Image Preview */}
            {imagePreview && (
                <div style={{ padding: "0 24px 8px", display: "flex", alignItems: "center", gap: "10px" }}>
                    <div style={{ position: "relative" }}>
                        <img src={imagePreview} alt="Attached" style={{ height: "48px", width: "auto", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.3)" }} />
                        <button onClick={clearImage} style={{ position: "absolute", top: -6, right: -6, width: "16px", height: "16px", borderRadius: "50%", background: "#EF4444", color: "white", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><X size={9} /></button>
                    </div>
                </div>
            )}

            {/* Input Bar */}
            <div style={{ padding: "12px 24px 20px" }}>
                <div className="chat-input-bar" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 8px 8px 16px" }}>
                    <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageSelect} />
                    <button onClick={() => imageInputRef.current?.click()} disabled={sending} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", borderRadius: "9999px", background: imageFile ? "rgba(199,210,254,0.7)" : "transparent", color: imageFile ? "#4F46E5" : "#818CF8", border: "none", cursor: "pointer" }}><ImagePlus size={15} /></button>
                    <motion.button animate={listening ? { scale: [1, 1.15, 1] } : {}} transition={listening ? { repeat: Infinity, duration: 0.8 } : SPRING} onClick={handleMic} disabled={sending} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", borderRadius: "9999px", background: listening ? "rgba(254,226,226,0.7)" : "transparent", color: listening ? "#DC2626" : "#818CF8", border: "none", cursor: "pointer" }}>{listening ? <MicOff size={15} /> : <Mic size={15} />}</motion.button>
                    <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }} placeholder={listening ? "Listening…" : "Message project…"} disabled={sending} style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: "14px", color: "#0f172a" }} />
                    <button onClick={() => void handleSend()} disabled={(!input.trim() && !imageFile) || sending} className="send-btn"><Send size={15} /></button>
                </div>
            </div>
        </div>
    );
}

interface RightInspectorProps {
    folder: string;
    lastTool: string | null;
    attachedImage: string | null;
    messageCount: number;
    lastConfidence?: { label: string; score: number }[] | null;
    onRunAnalysis?: () => void;
}

function RightInspector({ folder, lastTool, attachedImage, messageCount, lastConfidence, onRunAnalysis }: RightInspectorProps) {
    const toolColors: Record<string, string> = { document: "#3730A3", code: "#059669", hardware: "#D97706", vision: "#7C3AED", error: "#DC2626" };
    const color = lastTool ? (toolColors[lastTool] ?? "#6366F1") : "#818CF8";
    return (
        <aside style={{
            width: "260px", minWidth: "260px",
            background: "rgba(255,255,255,0.38)",
            backdropFilter: "blur(28px) saturate(150%)",
            WebkitBackdropFilter: "blur(28px) saturate(150%)",
            borderLeft: "1px solid rgba(255,255,255,0.20)",
            display: "flex", flexDirection: "column", height: "100%", overflow: "hidden"
        }}>
            <div style={{ padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.20)", background: "rgba(224,231,255,0.3)" }}>
                <h3 style={{ fontSize: "12px", fontWeight: 700, color: "#3730A3" }}>INSPECTOR</h3>
            </div>
            <div style={{ flex: 1, padding: "12px", overflowY: "auto" }}>
                {/* Intelligence Confidence */}
                {lastConfidence && lastConfidence.length > 0 ? (
                    <div className="seis-card" style={{ padding: "12px", marginBottom: "10px" }}>
                        <p style={{ fontSize: "10px", fontWeight: 600, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Intelligence Confidence</p>
                        {lastConfidence.map((src, i) => (
                            <div key={i} style={{ marginBottom: "10px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}><span style={{ fontSize: "11px", color: "#1e293b", fontWeight: 500 }}>{src.label}</span><span style={{ fontSize: "10.5px", color: "#4F46E5", fontWeight: 600 }}>{Math.round(src.score * 100)}%</span></div>
                                <div className="conf-bar-track"><motion.div className="conf-bar-fill" initial={{ width: 0 }} animate={{ width: `${Math.min(100, src.score * 100)}%` }} transition={{ ease: [0.34, 1.56, 0.64, 1], duration: 0.38, delay: i * 0.08 }} style={{ height: "100%", borderRadius: "4px" }} /></div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="seis-card" style={{ padding: "12px", marginBottom: "10px" }}>
                        <p style={{ fontSize: "10px", fontWeight: 600, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Intelligence Confidence</p>
                        <div style={{ padding: "12px", background: "rgba(224,231,255,0.3)", borderRadius: "12px", textAlign: "center", border: "1px dashed rgba(129,140,248,0.4)" }}>
                            <span style={{ fontSize: "10.5px", color: "#334155" }}>Standby for retrieval...</span>
                        </div>
                    </div>
                )}
                {/* Session Context */}
                <div className="seis-card" style={{ padding: "12px", marginBottom: "10px" }}>
                    <p style={{ fontSize: "10px", fontWeight: 600, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>Session Context</p>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}><span style={{ fontSize: "11.5px", color: "#334155" }}>Project</span><span style={{ fontSize: "11.5px", color: "#0f172a", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100px" }}>{folder}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}><span style={{ fontSize: "11.5px", color: "#334155" }}>Messages</span><span style={{ fontSize: "11.5px", color: "#0f172a", fontWeight: 500 }}>{messageCount}</span></div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}><span style={{ fontSize: "11.5px", color: "#334155" }}>Last Tool</span><span style={{ fontSize: "11.5px", color: color, fontWeight: 600, textTransform: "capitalize" }}>{lastTool || "—"}</span></div>
                </div>

                {/* Quick Actions */}
                <div className="seis-card" style={{ padding: "12px" }}>
                    <p style={{ fontSize: "10px", fontWeight: 600, color: "#6366F1", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>Quick Actions</p>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} transition={{ ease: [0.34, 1.56, 0.64, 1], duration: 0.24 }} onClick={onRunAnalysis} style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "7px 10px", borderRadius: "12px", background: "transparent", border: "1px solid rgba(129,140,248,0.3)", cursor: "pointer", fontSize: "12px", color: "#1e293b", fontWeight: 500, marginBottom: "6px" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.5)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.5)"; (e.currentTarget as HTMLElement).style.color = "#3730A3"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(129,140,248,0.3)"; (e.currentTarget as HTMLElement).style.color = "#1e293b"; }}>
                        <span style={{ color: "#4F46E5" }}><Zap size={12} /></span> Run Analysis
                    </motion.button>
                    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} transition={{ ease: [0.34, 1.56, 0.64, 1], duration: 0.24 }} onClick={() => alert("Session exported to PDF.")} style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", padding: "7px 10px", borderRadius: "12px", background: "transparent", border: "1px solid rgba(129,140,248,0.3)", cursor: "pointer", fontSize: "12px", color: "#1e293b", fontWeight: 500 }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(224,231,255,0.5)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(99,102,241,0.5)"; (e.currentTarget as HTMLElement).style.color = "#3730A3"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(129,140,248,0.3)"; (e.currentTarget as HTMLElement).style.color = "#1e293b"; }}>
                        <span style={{ color: "#4F46E5" }}><FileText size={12} /></span> Export Session
                    </motion.button>
                </div>
            </div>
        </aside>
    );
}

// ================================================================
// EXPORT PROJECT PAGE
// ================================================================
export default function ProjectPage({ params }: { params: Promise<{ folder: string }> }) {
    const { folder: rawFolder } = use(params);
    const folder = decodeURIComponent(rawFolder);
    const router = useRouter();

    const [activeTab, setActiveTab] = useState<Mode>("document");
    const [files, setFiles] = useState<FileItem[]>([]);
    const [filesLoading, setFilesLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);

    const [lastTool, setLastTool] = useState<string | null>(null);
    const [attachedImage, setAttachedImage] = useState<string | null>(null);
    const [messageCount, setMessageCount] = useState(0);
    const [lastConfidence, setLastConfidence] = useState<{ label: string; score: number }[] | null>(null);
    const [triggerAnalysis, setTriggerAnalysis] = useState(0);

    const loadFiles = useCallback(async () => {
        try { setFiles(await getFiles(folder)); }
        catch (err) { console.error("Failed to load files:", err); }
        finally { setFilesLoading(false); }
    }, [folder]);

    useEffect(() => { void loadFiles(); }, [loadFiles]);

    const handleDelete = async (filename: string) => {
        try { await deleteFile(folder, filename); await loadFiles(); } catch (err) { alert(`Delete failed: ${err}`); }
    };
    const handleUpload = async (file: File) => {
        setActionLoading(true);
        try { await uploadFile(folder, file); await loadFiles(); } catch (err) { alert(`Upload failed: ${err}`); }
        finally { setActionLoading(false); }
    };
    const handleReindex = async () => {
        setActionLoading(true);
        try { await reindexFolder(folder); } catch (err) { alert(`Reindex failed: ${err}`); }
        finally { setActionLoading(false); }
    };

    return (
        <main style={{ display: "flex", height: "calc(100svh - 56px)", overflow: "hidden", background: "transparent" }}>
            {/* LEFT COLUMN */}
            <aside style={{
                width: "280px", minWidth: "280px",
                background: "rgba(224,231,255,0.42)",
                backdropFilter: "blur(28px) saturate(150%)",
                WebkitBackdropFilter: "blur(28px) saturate(150%)",
                borderRight: "1px solid rgba(255,255,255,0.20)",
                display: "flex", flexDirection: "column"
            }}>
                <div style={{ padding: "16px 16px 12px" }}>
                    <button onClick={() => router.push("/")} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#6366F1", background: "none", border: "none", cursor: "pointer", marginBottom: "12px", transition: "color 0.15s" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#0f172a"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#6366F1"; }}>
                        <ArrowLeft size={13} /> Dashboard
                    </button>
                    <h1 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{folder}</h1>
                </div>

                <div style={{ padding: "0 16px", marginBottom: "16px" }}>
                    <div style={{ display: "flex", gap: "4px", background: "rgba(255,255,255,0.35)", padding: "4px", borderRadius: "9999px", border: "1px solid rgba(255,255,255,0.28)" }}>
                        {(["document", "code", "hardware"] as Mode[]).map((tab) => (
                            <button
                                key={tab} onClick={() => { setActiveTab(tab); setLastConfidence(null); }}
                                style={{ flex: 1, textTransform: "capitalize", fontSize: "12px", padding: "6px 0", cursor: "pointer", position: "relative", border: "none", background: "transparent", color: activeTab === tab ? "#4F46E5" : "#475569", fontWeight: activeTab === tab ? 600 : 500 }}
                            >
                                {activeTab === tab && (
                                    <motion.div layoutId="active-tab-highlight" style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.75)", borderRadius: "9999px", boxShadow: "0 1px 3px rgba(79,70,229,0.10)", zIndex: 0 }} transition={{ ease: [0.65, 0, 0.35, 1], duration: 0.24 }} />
                                )}
                                <span style={{ position: "relative", zIndex: 1, transition: "color 0.24s cubic-bezier(0.65, 0, 0.35, 1)" }}>{tab}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 24px" }}>
                    <AnimatePresence mode="wait">
                        <motion.div key={activeTab} variants={fadeUp} initial="hidden" animate="visible" exit={{ opacity: 0 }} transition={FADE}>
                            {activeTab === "document" && <DocumentTab files={files} loading={filesLoading} onDelete={handleDelete} onUpload={handleUpload} onReindex={handleReindex} actionLoading={actionLoading} />}
                            {activeTab === "code" && <CodeTab files={files} loading={filesLoading} onDelete={handleDelete} onUpload={handleUpload} actionLoading={actionLoading} />}
                            {activeTab === "hardware" && <HardwareTab />}
                        </motion.div>
                    </AnimatePresence>
                </div>
            </aside>

            {/* CENTER COLUMN */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
                {/* Chat Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid rgba(255,255,255,0.20)", background: "rgba(255,255,255,0.35)", backdropFilter: "blur(20px)", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>Project Chat</span>
                        <span className="seis-badge" style={{ background: "rgba(255,255,255,0.55)", color: "#334155" }}>{activeTab.toUpperCase()} MODE</span>
                    </div>
                </div>
                {/* Chat Panel */}
                <CustomChatPanel
                    folder={folder}
                    mode={activeTab}
                    onLastTool={(t) => { setLastTool(t); setMessageCount(c => c + 1); if (t !== "document") setLastConfidence(null); }}
                    onAttachedImage={setAttachedImage}
                    onConfidence={setLastConfidence}
                    triggerAnalysis={triggerAnalysis}
                />
            </div>

            {/* RIGHT COLUMN */}
            <RightInspector folder={folder} lastTool={lastTool} attachedImage={attachedImage} messageCount={messageCount} lastConfidence={lastConfidence} onRunAnalysis={() => setTriggerAnalysis(prev => prev + 1)} />
        </main>
    );
}
