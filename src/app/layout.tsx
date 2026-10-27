import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/themeScript";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claude Lens",
  description: "Browse Claude Code sessions and dig into any answer with nested sub-agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The boot script sets data-theme before React loads, so the server's HTML differs on purpose.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        {/* Snippets that spawned a sub-thread (CSS Custom Highlight API). */}
        <style>{`::highlight(subthread){background-color:var(--hl)}::highlight(subthread-active){background-color:var(--hl-active)}`}</style>
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
