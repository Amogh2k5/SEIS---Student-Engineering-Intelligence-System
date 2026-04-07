"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, type Transition, type Variants } from "framer-motion";
import { Cpu, Clock } from "lucide-react";
import { getLatestReading, getReadingsHistory, type Reading } from "@/lib/api";
import GlassCard from "@/components/GlassCard";

// ================================================================
// CONSTANTS
// ================================================================

const FADE_IN: Transition = { duration: 0.25, ease: "easeOut" };

const cardVariants: Variants = {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0 },
};

const historyVariants: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

const historyItemVariants: Variants = {
    hidden: { opacity: 0, scale: 0.93 },
    visible: { opacity: 1, scale: 1 },
};

const historyItemTransition: Transition = { duration: 0.18 };

// ================================================================
// HELPERS
// ================================================================

function fmtTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function fmtDate(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString([], {
        month: "short",
        day: "numeric",
    });
}

// ================================================================
// PROPS
// ================================================================

export interface HardwarePanelProps {
    deviceId: string;
    sensorType: string;
    /** Polling interval in ms. Defaults to 5000. */
    refreshInterval?: number;
}

// ================================================================
// SKELETON
// ================================================================

function Skeleton({ wide = false }: { wide?: boolean }) {
    return (
        <div
            className={`animate-pulse rounded-xl bg-white/5 border border-white/8 h-14 ${wide ? "w-full" : "w-28"
                } shrink-0`}
        />
    );
}

// ================================================================
// LATEST VALUE CARD
// ================================================================

interface LatestCardProps {
    deviceId: string;
    sensorType: string;
    reading: Reading | null;
    loading: boolean;
    empty: boolean;
}

function LatestCard({ deviceId, sensorType, reading, loading, empty }: LatestCardProps) {
    // Flash animation when value changes
    const [flash, setFlash] = useState(false);
    const prevValue = useRef<number | null>(null);

    useEffect(() => {
        if (reading !== null && reading.value !== prevValue.current) {
            prevValue.current = reading.value;
            setFlash(true);
            const t = setTimeout(() => setFlash(false), 600);
            return () => clearTimeout(t);
        }
    }, [reading]);

    if (loading) {
        return <Skeleton wide />;
    }

    if (empty || !reading) {
        return (
            <div className="flex items-center gap-3 px-4 py-4 rounded-2xl
        bg-white/5 border border-red-500/20 backdrop-blur-md">
                <Cpu size={18} className="text-red-400/60 shrink-0" />
                <p className="text-sm text-red-400/70">No data found for this device</p>
            </div>
        );
    }

    return (
        <GlassCard
            className="flex items-center justify-between px-5 py-5"
        >
            {/* Left: labels */}
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <Cpu size={14} className="text-seis-accent" />
                    <span className="text-xs font-medium text-white/60 tracking-wide">
                        {deviceId}
                    </span>
                </div>
                <span className="text-[11px] text-white/35">{sensorType}</span>
            </div>

            {/* Right: value */}
            <div className="text-right">
                <motion.p
                    animate={flash ? { color: "#4F8EF7", scale: 1.08 } : { color: "#4F8EF7", scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className="text-3xl font-bold tabular-nums"
                    style={{ textShadow: flash ? "0 0 20px rgba(79,142,247,0.7)" : "0 0 10px rgba(79,142,247,0.3)" }}
                >
                    {reading.value}
                </motion.p>
                <div className="flex items-center justify-end gap-1 mt-1">
                    <Clock size={10} className="text-white/25" />
                    <span className="text-[10px] text-white/25">{fmtTime(reading.timestamp)}</span>
                </div>
            </div>
        </GlassCard>
    );
}

// ================================================================
// HISTORY CARD (single reading)
// ================================================================

function HistoryCard({ reading }: { reading: Reading }) {
    return (
        <motion.div
            variants={historyItemVariants}
            transition={historyItemTransition}
            className="shrink-0 w-24"
        >
            <GlassCard className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl">
                <span className="text-base font-semibold text-seis-accent tabular-nums">
                    {reading.value}
                </span>
                <span className="text-[10px] text-white/30 text-center leading-tight">
                    {fmtTime(reading.timestamp)}
                </span>
                <span className="text-[9px] text-white/20">{fmtDate(reading.timestamp)}</span>
            </GlassCard>
        </motion.div>
    );
}

// ================================================================
// HARDWARE PANEL
// ================================================================

export default function HardwarePanel({
    deviceId,
    sensorType,
    refreshInterval = 5000,
}: HardwarePanelProps) {
    const [latest, setLatest] = useState<Reading | null>(null);
    const [history, setHistory] = useState<Reading[]>([]);
    const [loadingLatest, setLoadingLatest] = useState(true);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [empty, setEmpty] = useState(false);

    // ── Fetch latest ──────────────────────────────────────────────
    const fetchLatest = useCallback(async () => {
        try {
            const data = await getLatestReading(deviceId, sensorType);
            if (data === null) {
                setEmpty(true);
            } else {
                setLatest(data);
                setEmpty(false);
            }
        } catch {
            setEmpty(true);
        } finally {
            setLoadingLatest(false);
        }
    }, [deviceId, sensorType]);

    // ── Fetch history ─────────────────────────────────────────────
    const fetchHistory = useCallback(async () => {
        try {
            const data = await getReadingsHistory(deviceId, sensorType, 100);
            if (data) setHistory(data.readings);
        } catch {
            // silently fail — history is supplementary
        } finally {
            setLoadingHistory(false);
        }
    }, [deviceId, sensorType]);

    // ── Polling ───────────────────────────────────────────────────
    useEffect(() => {
        void fetchLatest();
        void fetchHistory();

        const latestInterval = setInterval(() => void fetchLatest(), refreshInterval);
        const historyInterval = setInterval(() => void fetchHistory(), refreshInterval);

        return () => {
            clearInterval(latestInterval);
            clearInterval(historyInterval);
        };
    }, [fetchLatest, fetchHistory, refreshInterval]);

    return (
        <div className="flex flex-col gap-6">

            {/* ── Latest Reading ──────────────────────────────── */}
            <section>
                <h3 className="text-xs font-semibold tracking-widest uppercase text-white/35 mb-3">
                    Latest Reading
                </h3>
                <LatestCard
                    deviceId={deviceId}
                    sensorType={sensorType}
                    reading={latest}
                    loading={loadingLatest}
                    empty={empty}
                />
            </section>

            {/* ── History ─────────────────────────────────────── */}
            {!empty && (
                <section>
                    <h3 className="text-xs font-semibold tracking-widest uppercase text-white/35 mb-3">
                        History{" "}
                        <span className="text-white/20 normal-case tracking-normal font-normal ml-1">
                            (last {history.length})
                        </span>
                    </h3>

                    {loadingHistory ? (
                        <div className="flex gap-3 overflow-x-auto pb-2">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <Skeleton key={i} />
                            ))}
                        </div>
                    ) : history.length === 0 ? (
                        <p className="text-sm text-white/25 py-4 text-center">
                            No history yet
                        </p>
                    ) : (
                        <div className="overflow-x-auto pb-2">
                            <AnimatePresence>
                                <motion.div
                                    variants={historyVariants}
                                    initial="hidden"
                                    animate="visible"
                                    className="flex gap-3 w-max"
                                >
                                    {/* Reverse so newest reading is on the left */}
                                    {[...history].reverse().map((r, i) => (
                                        <HistoryCard key={i} reading={r} />
                                    ))}
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
