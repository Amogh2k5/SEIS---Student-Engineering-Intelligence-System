"use client";

/**
 * GlassCard — reusable glassmorphism card with:
 *  - Mouse-tracking 3D tilt (15° max, spring stiffness 400)
 *  - Shimmer sweep on hover
 *  - Animated flowing gradient border
 *  - Hover glow (box-shadow)
 *
 * Usage:
 *   <GlassCard>…children…</GlassCard>
 *   <GlassCard className="h-40" onClick={…}>…</GlassCard>
 *   <GlassCard tilt={false}>…</GlassCard>  ← disable tilt for panels
 */

import React, { useRef, useState } from "react";
import {
    motion,
    AnimatePresence,
    useMotionValue,
    useSpring,
    useTransform,
    type Transition,
} from "framer-motion";

// ================================================================
// CONSTANTS
// ================================================================

const TILT_SPRING: { stiffness: number; damping: number } = {
    stiffness: 400,
    damping: 25,
};
const MAX_TILT = 10;

// ================================================================
// PROPS
// ================================================================

export interface GlassCardProps {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    onClick?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    /** Enable/disable 3D tilt effect. Default: true */
    tilt?: boolean;
    /** Enable/disable shimmer on hover. Default: true */
    shimmer?: boolean;
    /** Enable/disable hover glow. Default: true */
    glow?: boolean;
    /** Enable animated flowing gradient border. Default: true */
    animatedBorder?: boolean;
    /** Whether this card is clickable (adds cursor-pointer) */
    interactive?: boolean;
    as?: "div" | "article" | "section" | "li";
}

// ================================================================
// GLASS CARD
// ================================================================

export default function GlassCard({
    children,
    className = "",
    style,
    onClick,
    onMouseEnter,
    onMouseLeave,
    tilt = true,
    shimmer = true,
    glow = true,
    animatedBorder = true,
    interactive = false,
}: GlassCardProps) {
    const cardRef = useRef<HTMLDivElement>(null);
    const [hovered, setHovered] = useState(false);

    // ── Tilt tracking ─────────────────────────────────────────────
    const rawX = useMotionValue(0);
    const rawY = useMotionValue(0);
    const rotateX = useSpring(
        useTransform(rawY, [-0.5, 0.5], [MAX_TILT, -MAX_TILT]),
        TILT_SPRING
    );
    const rotateY = useSpring(
        useTransform(rawX, [-0.5, 0.5], [-MAX_TILT, MAX_TILT]),
        TILT_SPRING
    );

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!tilt) return;
        const rect = cardRef.current?.getBoundingClientRect();
        if (!rect) return;
        rawX.set((e.clientX - rect.left) / rect.width - 0.5);
        rawY.set((e.clientY - rect.top) / rect.height - 0.5);
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
        rawX.set(0);
        rawY.set(0);
        setHovered(false);
        onMouseLeave?.();
    };

    const handleMouseEnter = () => {
        setHovered(true);
        onMouseEnter?.();
    };

    // ── Hover glow ────────────────────────────────────────────────
    const hoverProps = glow
        ? {
            whileHover: {
                boxShadow: "0 0 28px rgba(79, 70, 229, 0.5)",
            },
        }
        : {};

    const tiltStyle = tilt
        ? {
            rotateX,
            rotateY,
            transformStyle: "preserve-3d" as const,
            perspective: 800,
        }
        : {};

    return (
        <motion.div
            ref={cardRef}
            {...hoverProps}
            style={{
                ...tiltStyle,
                position: "relative",
                overflow: "hidden",
                ...style,
            }}
            className={`
        bg-white/45 backdrop-blur-3xl saturate-150 ring-1 ring-inset ring-white/20 shadow-glass-long rounded-3xl
        ${interactive || onClick ? "cursor-pointer" : ""}
        ${className}
      `}
            onClick={onClick}
            onMouseMove={handleMouseMove}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* ── Animated gradient border ───────────────────────────── */}
            {animatedBorder && (
                <motion.div
                    aria-hidden="true"
                    animate={{
                        background: [
                            "linear-gradient(0deg,   rgba(79,70,229,0.25) 0%, transparent 50%, transparent 100%)",
                            "linear-gradient(90deg,  rgba(79,70,229,0.25) 0%, transparent 50%, transparent 100%)",
                            "linear-gradient(180deg, rgba(79,70,229,0.25) 0%, transparent 50%, transparent 100%)",
                            "linear-gradient(270deg, rgba(79,70,229,0.25) 0%, transparent 50%, transparent 100%)",
                            "linear-gradient(360deg, rgba(79,70,229,0.25) 0%, transparent 50%, transparent 100%)",
                        ],
                    }}
                    transition={{
                        duration: 4,
                        repeat: Infinity,
                        ease: "linear",
                    }}
                    style={{
                        position: "absolute",
                        inset: -1,
                        borderRadius: "inherit",
                        padding: 1,
                        zIndex: 0,
                        pointerEvents: "none",
                        WebkitMask:
                            "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                        WebkitMaskComposite: "xor",
                        maskComposite: "exclude",
                    }}
                />
            )}

            {/* ── Inner gradient ────────────────────────────────────── */}
            <div
                aria-hidden="true"
                style={{
                    position: "absolute",
                    inset: 0,
                    background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 60%)",
                    pointerEvents: "none",
                    zIndex: 1,
                }}
            />

            {/* ── Shimmer sweep on hover ────────────────────────────── */}
            {shimmer && (
                <AnimatePresence>
                    {hovered && (
                        <motion.div
                            key="shimmer"
                            initial={{ x: "-100%" }}
                            animate={{ x: "200%" }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.6, ease: "easeInOut" }}
                            aria-hidden="true"
                            style={{
                                position: "absolute",
                                inset: 0,
                                background:
                                    "linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%)",
                                pointerEvents: "none",
                                zIndex: 2,
                            }}
                        />
                    )}
                </AnimatePresence>
            )}

            {/* ── Content ───────────────────────────────────────────── */}
            <div style={{ position: "relative", zIndex: 3 }}>{children}</div>
        </motion.div>
    );
}
