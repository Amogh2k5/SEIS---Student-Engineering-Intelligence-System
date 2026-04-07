"use client";

import React, {
    useState,
    useRef,
    useEffect,
    useCallback,
} from "react";
import { motion, AnimatePresence, type Transition, type Variants } from "framer-motion";
import { Send, Mic, MicOff, ImagePlus, X } from "lucide-react";
import {
    sendChat,
    sendVisionChat,
    type ChatResponse,
    type DocumentChatResponse,
    type CodeChatResponse,
    type HardwareChatResponse,
    type ClarificationResponse,
    type ErrorResponse,
} from "@/lib/api";
import { getSessionId } from "@/lib/session";
import GlassCard from "@/components/GlassCard";

// ================================================================
// TYPES
// ================================================================

type Role = "user" | "assistant";

type ToolType = "document" | "code" | "hardware" | "clarification" | "error" | "unknown";

interface ParsedResponse {
    tool: ToolType;
    answer?: string;       // document / clarification
    code?: string;         // code
    language?: string;     // code
    explanation?: string;  // code
    sources?: string[];    // document (folder_used)
    error?: string;        // error
    analysis?: string;     // hardware
}

interface Message {
    id: string;
    role: Role;
    text: string;          // display text
    timestamp: Date;
    parsed?: ParsedResponse;
}

// ================================================================
// PROPS
// ================================================================

export interface ChatPanelProps {
    /** The project folder — passed to /chat so the backend auto-selects the right index. */
    folder: string;
    /** Optional mode override. Defaults to null (auto LLM planner). */
    initialMode?: string | null;
    /** When true, fills the flex parent height instead of capping at 400px. */
    fullHeight?: boolean;
    /** Custom empty state placeholder text. */
    emptyStateText?: string;
}

// ================================================================
// ANIMATION CONSTANTS
// ================================================================

const SPRING: Transition = { type: "spring", stiffness: 320, damping: 26 };

const msgVariants: Variants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
};

const msgTransition: Transition = { duration: 0.2, ease: "easeOut" };

const dotsVariants: Variants = {
    animate: { transition: { staggerChildren: 0.18 } },
};

const dotVariants: Variants = {
    animate: { y: [0, -5, 0], transition: { repeat: Infinity, duration: 0.7, ease: "easeInOut" } },
};

// ================================================================
// RESPONSE HELPERS
// ================================================================

const TOOL_LABELS: Record<ToolType, string> = {
    document: "📄 Document",
    code: "💻 Code",
    hardware: "🔌 Hardware",
    clarification: "❓ Clarifying",
    error: "⚠️ Error",
    unknown: "—",
};

function parseResponse(res: ChatResponse): ParsedResponse {
    // ErrorResponse — has 'error' key, no 'type'
    if ("error" in res) {
        return { tool: "error", error: (res as ErrorResponse).error };
    }
    // ClarificationResponse — has 'clarification_needed'
    if ("clarification_needed" in res) {
        const c = res as ClarificationResponse;
        return { tool: "clarification", answer: c.answer };
    }
    const typed = res as DocumentChatResponse | CodeChatResponse | HardwareChatResponse;
    if (typed.type === "document") {
        return { tool: "document", answer: typed.answer, sources: [typed.folder_used] };
    }
    if (typed.type === "code") {
        return {
            tool: "code",
            code: typed.code,
            language: typed.language,
            explanation: typed.explanation,
        };
    }
    if (typed.type === "hardware") {
        return { tool: "hardware", analysis: typed.analysis };
    }
    return { tool: "unknown", answer: "No response received." };
}

function responseToDisplayText(parsed: ParsedResponse): string {
    switch (parsed.tool) {
        case "document": return parsed.answer ?? "";
        case "clarification": return parsed.answer ?? "";
        case "hardware": return parsed.analysis ?? "";
        case "code": return parsed.explanation ?? "";
        case "error": return parsed.error ?? "An error occurred.";
        default: return "No response.";
    }
}

function formatTime(d: Date): string {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ================================================================
// SUB-COMPONENTS
// ================================================================

// Pulsing dots loading indicator
function TypingDots() {
    return (
        <motion.div
            variants={dotsVariants}
            animate="animate"
            className="flex items-center gap-1 px-3 py-2"
        >
            {[0, 1, 2].map((i) => (
                <motion.span
                    key={i}
                    variants={dotVariants}
                    className="w-1.5 h-1.5 rounded-full bg-seis-accent/60 inline-block"
                />
            ))}
        </motion.div>
    );
}

// Inline code block
function CodeBlock({ code, language }: { code: string; language?: string }) {
    return (
        <div className="mt-2 rounded-xl overflow-hidden border border-white/10">
            {language && (
                <div className="px-3 py-1 bg-seis-accent/10 border-b border-white/10 flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-widest uppercase text-seis-accent/70">
                        {language}
                    </span>
                </div>
            )}
            <pre className="px-3 py-3 text-xs text-white/75 overflow-x-auto bg-white/3 font-mono leading-relaxed whitespace-pre">
                {code}
            </pre>
        </div>
    );
}

// Message source badge
function SourceBadge({ folder }: { folder: string }) {
    return (
        <span className="inline-block mt-1 text-[10px] text-white/25">
            Source: <span className="text-seis-accent/50">{folder}</span>
        </span>
    );
}

// Tool badge
function ToolBadge({ tool }: { tool: ToolType }) {
    if (tool === "unknown") return null;
    return (
        <span className="text-[10px] text-white/30 font-medium mt-0.5 block">
            {TOOL_LABELS[tool]}
        </span>
    );
}

// A single message bubble
function MessageBubble({ message }: { message: Message }) {
    const isUser = message.role === "user";
    const parsed = message.parsed;

    return (
        <motion.div
            variants={msgVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={msgTransition}
            className={`flex flex-col gap-0.5 ${isUser ? "items-end" : "items-start"}`}
        >
            <div
                className={`max-w-[82%] px-3 py-2.5 rounded-2xl text-sm leading-relaxed
          ${isUser
                        ? "bg-seis-accent/15 border border-seis-accent/35 text-white rounded-br-sm"
                        : "bg-white/5 border border-white/10 text-white/85 rounded-bl-sm"
                    }`}
            >
                {/* Main text */}
                <p className="whitespace-pre-wrap">{message.text}</p>

                {/* Code block (code responses) */}
                {parsed?.tool === "code" && parsed.code && (
                    <CodeBlock code={parsed.code} language={parsed.language} />
                )}

                {/* Error display */}
                {parsed?.tool === "error" && (
                    <p className="mt-1 text-red-400/80 text-xs">{parsed.error}</p>
                )}
            </div>

            {/* Meta row */}
            <div className={`flex items-center gap-2 px-1 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                <span className="text-[10px] text-white/20">{formatTime(message.timestamp)}</span>
                {!isUser && parsed && <ToolBadge tool={parsed.tool} />}
                {!isUser && parsed?.tool === "document" && parsed.sources?.[0] && (
                    <SourceBadge folder={parsed.sources[0]} />
                )}
            </div>
        </motion.div>
    );
}

// ================================================================
// CHAT PANEL
// ================================================================

export default function ChatPanel({ folder, initialMode = null, fullHeight = false, emptyStateText }: ChatPanelProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // ── Image state ─────────────────────────────────────────────
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);

    // ── Speech-to-Text state ────────────────────────────────────
    const [listening, setListening] = useState(false);
    const recognitionRef = useRef<SpeechRecognition | null>(null);

    // Auto-scroll on new messages
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, sending]);

    // ── Image picker handler ────────────────────────────────────
    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
        // Focus text input so user can type question
        inputRef.current?.focus();
    };

    const clearImage = () => {
        setImageFile(null);
        if (imagePreview) URL.revokeObjectURL(imagePreview);
        setImagePreview(null);
        if (imageInputRef.current) imageInputRef.current.value = "";
    };

    // ── Mic / Speech-to-Text handler ────────────────────────────
    const stopMicRef = useRef(false);

    const startMic = useCallback(() => {
        stopMicRef.current = false;
        const SpeechRecognition =
            (window as typeof window & { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition })
                .SpeechRecognition ||
            (window as typeof window & { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

        if (!SpeechRecognition) {
            alert("Speech recognition is not supported in your browser. Try Chrome or Edge.");
            return;
        }

        const turnOn = () => {
            if (stopMicRef.current) return;

            const rec = new SpeechRecognition();
            rec.lang = "en-US";
            rec.interimResults = false;
            rec.maxAlternatives = 1;
            rec.continuous = true;

            rec.onstart = () => setListening(true);
            
            rec.onend = () => {
                if (!stopMicRef.current) {
                    setTimeout(turnOn, 100);
                } else {
                    setListening(false);
                }
            };
            
            rec.onerror = (event: SpeechRecognitionErrorEvent) => {
                if (event.error === "no-speech" || event.error === "aborted" || event.error === "network") return;
                stopMicRef.current = true;
                setListening(false);
            };

            rec.onresult = (event: SpeechRecognitionEvent) => {
                const transcript = event.results[event.results.length - 1][0].transcript;
                setInput((prev) => (prev ? prev + " " + transcript : transcript));
                inputRef.current?.focus();
            };

            recognitionRef.current = rec;
            try { rec.start(); } catch {
                if (!stopMicRef.current) setTimeout(turnOn, 500);
            }
        };

        turnOn();
    }, []);

    const handleMic = useCallback(() => {
        if (listening) {
            stopMicRef.current = true;
            recognitionRef.current?.stop();
            setListening(false);
        } else {
            startMic();
        }
    }, [listening, startMic]);

    // ── Main send handler (text-only — identical to original) ───
    const handleSend = useCallback(async () => {
        const text = input.trim();
        if ((!text && !imageFile) || sending) return;

        // Stop mic if active
        if (listening) {
            stopMicRef.current = true;
            recognitionRef.current?.stop();
            setListening(false);
        }

        // If image is attached, route to vision endpoint instead
        if (imageFile) {
            const question = text || "What is in this image? Describe it in detail.";
            const userMsg: Message = {
                id: crypto.randomUUID(),
                role: "user",
                text: `📎 ${imageFile.name}${text ? " — " + text : ""}`,
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, userMsg]);
            setInput("");
            clearImage();
            setSending(true);
            try {
                const res = await sendVisionChat(question, imageFile);
                const assistantMsg: Message = {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    text: res.answer,
                    timestamp: new Date(),
                    parsed: { tool: "document", answer: res.answer },
                };
                setMessages((prev) => [...prev, assistantMsg]);
            } catch (err) {
                const errMsg: Message = {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    text: err instanceof Error ? err.message : String(err),
                    timestamp: new Date(),
                    parsed: { tool: "error", error: err instanceof Error ? err.message : String(err) },
                };
                setMessages((prev) => [...prev, errMsg]);
            } finally {
                setSending(false);
            }
            return;
        }

        // Normal text chat — completely unchanged logic
        if (!text) return;
        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: "user",
            text,
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        setSending(true);

        try {
            const res = await sendChat({
                question: text,
                mode: initialMode ?? null,
                folder,
                session_id: getSessionId(),
            });

            const parsed = parseResponse(res);
            const displayText = responseToDisplayText(parsed);

            const assistantMsg: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                text: displayText,
                timestamp: new Date(),
                parsed,
            };

            setMessages((prev) => [...prev, assistantMsg]);
        } catch (err) {
            const errMsg: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                text: err instanceof Error ? err.message : String(err),
                timestamp: new Date(),
                parsed: { tool: "error", error: err instanceof Error ? err.message : String(err) },
            };
            setMessages((prev) => [...prev, errMsg]);
        } finally {
            setSending(false);
        }
    }, [input, sending, folder, initialMode, imageFile, listening]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        }
    };

    return (
        <div
            className="flex flex-col rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md overflow-hidden"
            style={fullHeight ? { flex: 1, minHeight: 0 } : { maxHeight: "400px" }}
        >
            {/* ── Header ──────────────────────────────────────── */}
            <div className="px-5 py-3 border-b border-white/8 shrink-0 flex items-center justify-between">
                <h3 className="text-xs font-semibold tracking-widest uppercase text-white/35">
                    Chat
                </h3>
                <span className="text-[10px] text-white/20">{folder}</span>
            </div>

            {/* ── Message history ──────────────────────────── */}
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 min-h-0">

                {/* Empty state */}
                {messages.length === 0 && !sending && (
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.2 }}
                        className="text-sm text-white/20 text-center my-auto leading-relaxed"
                    >
                        {emptyStateText ?? <>Ask anything about this project —{"  "}<br />I&apos;ll figure out the rest</>}
                    </motion.p>
                )}

                {/* Messages */}
                <AnimatePresence initial={false}>
                    {messages.map((msg) => (
                        <MessageBubble key={msg.id} message={msg} />
                    ))}
                </AnimatePresence>

                {/* Loading dots */}
                {sending && (
                    <motion.div
                        variants={msgVariants}
                        initial="hidden"
                        animate="visible"
                        transition={msgTransition}
                        className="flex items-start"
                    >
                        <div className="rounded-2xl rounded-bl-sm bg-white/5 border border-white/10">
                            <TypingDots />
                        </div>
                    </motion.div>
                )}

                <div ref={bottomRef} />
            </div>

            {/* ── Input bar ────────────────────────────────── */}
            <div className="px-4 py-3 border-t border-white/8 shrink-0">

                {/* Image preview strip — only shown when an image is selected */}
                {imagePreview && (
                    <div className="flex items-center gap-2 mb-2 px-1">
                        <div className="relative group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={imagePreview}
                                alt="Attached"
                                className="h-12 w-auto rounded-lg border border-white/15 object-cover"
                            />
                            <button
                                onClick={clearImage}
                                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500/80
                                    flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Remove image"
                            >
                                <X size={9} className="text-white" />
                            </button>
                        </div>
                        <span className="text-[10px] text-white/30 truncate max-w-[120px]">{imageFile?.name}</span>
                    </div>
                )}

                <div
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl
            bg-white/5 border border-white/10
            focus-within:border-seis-accent/50 focus-within:shadow-glow
            transition-all duration-200"
                >
                    {/* Hidden file input for images */}
                    <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={handleImageSelect}
                        id="chat-image-input"
                    />

                    {/* Image attach button */}
                    <motion.button
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.92 }}
                        transition={SPRING}
                        onClick={() => imageInputRef.current?.click()}
                        disabled={sending}
                        className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0
              bg-white/5 border transition-colors
              disabled:opacity-25 disabled:cursor-not-allowed
              ${imageFile ? "border-green-400/60 text-green-400" : "border-white/15 hover:border-white/30 text-white/40 hover:text-white/60"}`}
                        aria-label="Attach image"
                        title="Attach an image (circuit photo, diagram, etc.)"
                    >
                        <ImagePlus size={13} />
                    </motion.button>

                    {/* Mic button (Web Speech API — free) */}
                    <motion.button
                        whileHover={{ scale: 1.08 }}
                        whileTap={{ scale: 0.92 }}
                        animate={listening ? { scale: [1, 1.12, 1] } : {}}
                        transition={listening ? { repeat: Infinity, duration: 0.8 } : SPRING}
                        onClick={handleMic}
                        disabled={sending}
                        className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0
              bg-white/5 border transition-colors
              disabled:opacity-25 disabled:cursor-not-allowed
              ${listening ? "border-red-400/70 text-red-400" : "border-white/15 hover:border-white/30 text-white/40 hover:text-white/60"}`}
                        aria-label={listening ? "Stop recording" : "Speak your message"}
                        title={listening ? "Listening… click to stop" : "Speak your message"}
                    >
                        {listening ? <MicOff size={13} /> : <Mic size={13} />}
                    </motion.button>

                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={listening ? "Listening…" : imageFile ? "Ask about this image…" : "Ask anything about this project…"}
                        disabled={sending}
                        className="flex-1 bg-transparent text-sm text-white
              placeholder:text-white/20 outline-none disabled:opacity-40"
                    />

                    <motion.button
                        whileHover={{
                            scale: 1.08,
                            boxShadow: "0 0 14px rgba(79,142,247,0.55)",
                        }}
                        whileTap={{ scale: 0.92 }}
                        transition={SPRING}
                        onClick={handleSend}
                        disabled={(!input.trim() && !imageFile) || sending}
                        className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0
              bg-white/5 border border-seis-accent/40
              hover:border-seis-accent/80 transition-colors
              disabled:opacity-25 disabled:cursor-not-allowed"
                        aria-label="Send message"
                    >
                        <Send size={14} className="text-seis-accent" />
                    </motion.button>
                </div>
            </div>
        </div>
    );
}