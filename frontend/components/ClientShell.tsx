"use client";

import { usePathname } from "next/navigation";
import GlobalAssistant from "@/components/GlobalAssistant";
import React from "react";

/**
 * ClientShell — Liquid Glass edition
 * Full-bleed frosted-glass top bar with indigo-600 accent branding.
 */
export default function ClientShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const isHomepage = pathname === "/";

    return (
        <>
            {/* ── Global fixed header — Liquid Glass ─────────── */}
            <header
                style={{
                    position: "fixed",
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    background: "rgba(255,255,255,0.45)",
                    backdropFilter: "blur(28px) saturate(150%)",
                    WebkitBackdropFilter: "blur(28px) saturate(150%)",
                    borderBottom: "1px solid rgba(255,255,255,0.20)",
                    boxShadow: "0 4px 24px rgba(79,70,229,0.08), inset 0 -1px 0 rgba(255,255,255,0.3)",
                    padding: "0 24px",
                    height: "56px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                {/* Left: SEIS Logo */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <div
                        style={{
                            width: "30px",
                            height: "30px",
                            borderRadius: "8px",
                            background: "linear-gradient(135deg, #3730A3, #4F46E5)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            boxShadow: "0 2px 12px rgba(79,70,229,0.45)",
                        }}
                    >
                        <span style={{ color: "#fff", fontWeight: 700, fontSize: "13px", letterSpacing: "-0.5px" }}>S</span>
                    </div>
                    <div>
                        <span style={{ fontWeight: 700, fontSize: "15px", color: "#0f172a", letterSpacing: "-0.3px" }}>SEIS</span>
                    </div>
                </div>

                {/* Center: Nav links */}
                <nav style={{ display: "flex", gap: "4px" }}></nav>

                {/* Right: GlobalAssistant + avatar */}
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    {!isHomepage && <GlobalAssistant />}
                    <div
                        style={{
                            width: "30px",
                            height: "30px",
                            borderRadius: "50%",
                            background: "linear-gradient(135deg, #E0E7FF, #C7D2FE)",
                            border: "1.5px solid rgba(129,140,248,0.5)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#3730A3",
                            cursor: "pointer",
                        }}
                    >
                        A
                    </div>
                </div>
            </header>

            {/* Page content — padded below fixed header */}
            <div style={{ position: "relative", zIndex: 2, paddingTop: "56px" }}>
                {children}
            </div>
        </>
    );
}
