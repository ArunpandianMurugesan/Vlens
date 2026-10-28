# Changelog

Every Claude Lens release, newest first. The version lives in [`VERSION`](VERSION); `npm run release` builds the dmg for it and publishes it on the [Releases page](https://github.com/arun-innovates/claude-lens/releases).

Versions follow [semantic versioning](https://semver.org): **major** for big changes in how Lens works, **minor** for new features, **patch** for fixes.

## 1.0.0 — 2026-10-28

The first release of the Mac app.

**Sessions**
- One sidebar for every Claude Code session: terminal, desktop app and Lens. Grouped by folder, with Pinned, Active and Recent.
- Sessions update live while they run in a terminal. Only one place types at a time: take a terminal session over in Lens, or continue a Lens session in the terminal.
- History: what you worked on in the last 15 days, day by day, with Resume here / Terminal / Pin.
- Rename, pin, end and delete (to a trash you can restore from). Auto-restore after a crash or reboot.

**Chat that works like the terminal**
- Permission prompts with the terminal's choices: Yes, Yes and don't ask again (with the rule), No with a note. Keys 1–3, Esc.
- Plan approval, all five permission modes (starting in your CLI default, Shift+Tab cycles), Claude's multiple-choice questions, typing ahead while Claude works.
- Paste images, `/` commands and skills, a model per message, side questions in sub-agents.

**Visual replies**
- Mermaid flow diagrams, an Excalidraw teaching whiteboard, an inline file viewer, light and dark themes.

**Workspace**
- Home dashboard: usage limits, activity, context health with Compact and Fresh start.
- Coach: "Fix this now" signals from your week, session retros, and lessons you can apply to a Lens-owned block in CLAUDE.md.
- Lens Review (your PRs by repo), Marketplace (add your team's skills repo), Settings for account, model, MCP, skills, hooks, notifications and the coach.
- Desktop notifications when Claude needs you or finishes.
- Get started page for new installs: install Claude Code, sign in, connect GitHub.
