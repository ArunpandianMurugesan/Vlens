import type { Metadata } from "next";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/themeScript";

export const metadata: Metadata = {
  title: "Vlens",
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
      {/* Fonts: SF Pro and SF Mono, from the system (see --font-sans in globals.css). */}
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
