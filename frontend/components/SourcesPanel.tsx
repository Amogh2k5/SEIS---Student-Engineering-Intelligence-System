"use client";

import React from "react";
import { motion, AnimatePresence, type Transition, type Variants } from "framer-motion";
import { X, FileText } from "lucide-react";
import GlassCard from "@/components/GlassCard";

// ================================================================
// CONSTANTS
// ================================================================

const SPRING: Transition = { type: "spring", stiffness: 280, damping: 30 };

const panelVariants: Variants = {
    hidden: { x: 320, opacity: 0 },
    visible: { x: 0, opacity: 1 },
    exit: { x: 320, opacity: 0 },
};

const listVariants: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};

const itemVariants: Variants = {
    hidden: { opacity: 0, x: 16 },
    visible: { opacity: 1, x: 0 },
};

const itemTransition: Transition = { duration: 0.2, ease: "easeOut" };

// ================================================================
// HELPERS
// ================================================================

function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

// ================================================================
// PROPS
// ================================================================

export interface SourcesPanelProps {
    sources: string[];
    folder: string;
    isOpen: boolean;
    onClose: () => void;
}

// ================================================================
// SOURCES PANEL
// ================================================================

export default function SourcesPanel({
    sources,
    folder,
    isOpen,
    onClose,
}: SourcesPanelProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <motion.aside
                    key="sources-panel"
                    variants={panelVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    transition={SPRING}
                    className="fixed top-0 right-0 h-full w-72 z-40 flex flex-col
            border-l border-white/10 bg-white/5 backdrop-blur-xl"
                    style={{ boxShadow: "-8px 0 40px rgba(0,0,0,0.4)" }}
                    aria-label="Document sources"
                >
                    {/* ── Header ─────────────────────────────────────── */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
                        <div>
                            <h2
                                className="text-sm font-semibold text-white"
                                style={{ textShadow: "0 0 12px rgba(79,142,247,0.5)" }}
                            >
                                Sources
                            </h2>
                            <p className="text-[11px] text-white/30 mt-0.5">{folder}</p>
                        </div>

                        <motion.button
                            whileHover={{ scale: 1.1, boxShadow: "0 0 10px rgba(79,142,247,0.3)" }}
                            whileTap={{ scale: 0.9 }}
                            transition={SPRING}
                            onClick={onClose}
                            className="flex items-center justify-center w-7 h-7 rounded-lg
                bg-white/5 border border-white/10 hover:border-seis-accent/40
                transition-colors"
                            aria-label="Close sources"
                        >
                            <X size={13} className="text-white/60" />
                        </motion.button>
                    </div>

                    {/* ── Source list ────────────────────────────────── */}
                    <div className="flex-1 overflow-y-auto px-4 py-4">
                        {sources.length === 0 ? (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-sm text-white/25 text-center">
                                    No sources available
                                </p>
                            </div>
                        ) : (
                            <motion.ul
                                variants={listVariants}
                                initial="hidden"
                                animate="visible"
                                className="flex flex-col gap-2"
                            >
                                {sources.map((src, i) => (
                                    <motion.li
                                        key={i}
                                        variants={itemVariants}
                                        transition={itemTransition}
                                    >
                                        <GlassCard
                                            tilt={false}
                                            className="flex items-start gap-3 px-3 py-3 rounded-xl"
                                            style={{ borderLeftColor: "rgba(79,142,247,0.5)", borderLeftWidth: 2 }}
                                        >
                                            <FileText
                                                size={14}
                                                className="text-seis-accent shrink-0 mt-0.5"
                                            />
                                            <div className="min-w-0">
                                                <p className="text-sm text-white/85 font-medium truncate">
                                                    {basename(src)}
                                                </p>
                                                <p className="text-[11px] text-white/30 truncate mt-0.5">
                                                    {src}
                                                </p>
                                            </div>
                                        </GlassCard>
                                    </motion.li>
                                ))}
                            </motion.ul>
                        )}
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    );
}
