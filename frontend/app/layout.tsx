import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import ClientShell from "@/components/ClientShell";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "SEIS — Student Engineering Intelligence System",
  description:
    "AI-powered engineering assistant for documents, embedded code, and hardware sensor analysis.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
        style={{
          background: "linear-gradient(135deg, #e0e7ff 0%, #f0f4ff 42%, #ede9fe 100%)",
          backgroundAttachment: "fixed",
          minHeight: "100dvh",
          color: "#0f172a",
        }}
      >
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
