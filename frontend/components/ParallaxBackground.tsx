"use client";

import { useScroll, useTransform, motion } from "framer-motion";

/**
 * Full-viewport parallax background — mounts once in layout.tsx.
 * The image layer moves at 0 → -150px, blobs at 0 → -80px,
 * creating depth against the normally-scrolling page content.
 */
export default function ParallaxBackground() {
    const { scrollY } = useScroll();

    // Background image: moves slowest
    const bgY = useTransform(scrollY, [0, 1500], [0, -150]);

    // Blobs: move a bit faster than bg, but still slower than content
    const blobY = useTransform(scrollY, [0, 1500], [0, -80]);

    return (
        <>
            {/* ── Background image layer ─────────────────────────── */}
            <motion.div
                aria-hidden="true"
                style={{
                    y: bgY,
                    position: "fixed",
                    inset: 0,
                    zIndex: -2,
                    backgroundImage: "url('/background.png')",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    // no background-attachment: fixed — Framer Motion controls the offset
                }}
            />

            {/* ── Dark overlay ───────────────────────────────────── */}
            <div
                aria-hidden="true"
                style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: -1,
                    background: "rgba(10, 15, 30, 0.72)",
                }}
            />

            {/* ── Glow blobs (move slightly with scroll for depth) ── */}
            <motion.div
                aria-hidden="true"
                className="blob blob-accent"
                style={{
                    y: blobY,
                    position: "fixed",
                    width: "600px",
                    height: "600px",
                    top: "-120px",
                    left: "-160px",
                    zIndex: 0,
                }}
            />
            <motion.div
                aria-hidden="true"
                className="blob blob-accent"
                style={{
                    y: blobY,
                    position: "fixed",
                    width: "700px",
                    height: "700px",
                    bottom: "-180px",
                    right: "-180px",
                    zIndex: 0,
                }}
            />
            <motion.div
                aria-hidden="true"
                className="blob blob-accent"
                style={{
                    y: blobY,
                    position: "fixed",
                    width: "500px",
                    height: "500px",
                    top: "50%",
                    left: "50%",
                    translateX: "-50%",
                    translateY: "-50%",
                    opacity: 0.6,
                    zIndex: 0,
                }}
            />
        </>
    );
}
