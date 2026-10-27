# Claude Lens

A web UI for your Claude Code CLI sessions, with nested sub-agent threads.

- **Home dashboard**: what Lens opens to (click the logo to come back). Who you're signed in as, your 5-hour and weekly limits, sessions running and used this week, messages and tokens today, and a 14-day activity chart (tokens read or messages; hover for numbers, or switch to a table).
- **Context health**: every reply re-sends the whole session, so long sessions burn your limits fastest. The dashboard shows how many tokens Claude read vs. wrote today and lists your heaviest sessions with two fixes: **Compact** (runs `/compact`) and **Fresh start** (Claude writes a handoff note, then a new session in the same folder starts from it). Both are disabled for sessions that are open in a terminal or the desktop app. Compactions show in a session as a "Conversation compacted" divider you can expand.
- **Sidebar**: shows **Active** sessions, meaning ones open in a running Claude Code process (terminal or desktop app), plus **Pinned** ones, the session you have open, and **Recent**: sessions Lens started or replied in during the last 24 hours (their `claude -p` process exits after each reply, so they'd otherwise drop off). Remove one with ⋯ → Remove from Recent. A solid green dot means it's working, a hollow dot means it's waiting for you. Refreshes every 5s.
- **Session menu** (`⋯` on each item): **Rename** (the same as `/rename`, so the CLI sees it), **Pin / Unpin**, **End session** (stops the Claude CLI process; desktop-app sessions have to be ended in the app), and **Delete** (only once it's stopped; files move to Lens's `trash/` folder, so you can move them back to `~/.claude/projects/<project>/`).
- **Usage**: the bottom of the sidebar shows your plan's **5-hour** and **weekly** limits (how much is used and when each resets). Each session shows how full its **context window** is, in the bar and in the header. Limits update whenever Lens runs Claude; the refresh button sends one tiny Haiku request (about $0.0004). The page refreshes on its own only when the data is over 15 minutes old.
- **Chat view**: renders a session like a chat (markdown, thinking, tool calls with their output). A session that's still running in the terminal updates live.
- **New session**: click **New session**, pick a folder (a recent project folder, browse, or type a path like `~/Desktop/app`), and type the first message. It starts a real `claude` session there, the same as running `claude` in that folder.
- **File panel**: when Claude writes or edits a file, the reply shows a chip like `step1_basics.py +59 −0`; click it (or any file path in a reply, or the ↗ on a Read row) to open the file beside the chat. Tabs, a clickable folder breadcrumb, line numbers and syntax highlighting (Shiki, following the Lens theme). Opening from an edit highlights and scrolls to the changed lines. Markdown has Preview / Code, images preview, folders list their files. Buttons: reload, copy path, open in VS Code at that line, reveal in Finder, full width. Only files in your home folder open, and never folders like `~/.ssh` or `~/.aws`.
- **Message box**: paste, drop or 📎 attach images (PNG, JPEG, GIF, WebP; large ones are scaled down). Type `/` for a menu of slash commands and skills for that folder (arrow keys + Enter or Tab to pick). Commands you ran in a terminal, like `/compact`, show up in the chat with their output.
- **Reply to a session**: type at the bottom to continue the session with `claude --resume`. The reply is saved in the same session file, so the CLI sees it too. Pick **Can edit files** or **Read-only** under the box.
- **Sub-agents**: select any text in an answer and click **Ask Sub-Agent**. A panel slides in and runs a real `claude -p` in that session's project folder, focused on the snippet. You can select text inside a sub-agent answer to go one level deeper, as many times as you like.
- **Terminal console**: the bottom of each panel shows the real commands the sub-agent ran.

## Flow diagrams (built in)

Replies that contain a ```` ```mermaid ```` block are drawn as diagrams (flowcharts, sequence, state, ER, timeline…), in light or dark to match your system, with **code / copy / full screen** buttons. Arrows marked `animate: true` in the diagram move; Settings can animate every arrow.

Lens also ships its own Claude Code plugin in [`lens-plugin/`](lens-plugin) with a **`lens:diagrams`** skill that tells Claude when and how to draw a diagram. Lens passes it with `--plugin-dir` only to the runs it starts, so your terminal `claude` doesn't get it. Settings → **Flow diagrams** turns drawing, animate-every-arrow and the skill on or off separately. More built-in skills can go in the same plugin.

## Whiteboard (built in)

Replies with an ```` ```excalidraw ```` block (a JSON list of simple shapes, labels and arrows) are drawn as hand-drawn [Excalidraw](https://excalidraw.com) boards. **Open board** makes it a full editable whiteboard: move things, draw, add notes, export PNG or `.excalidraw`. Every Mermaid diagram also gets an **Open on whiteboard** button that converts it into editable shapes.

The built-in **`lens:whiteboard`** skill (in `lens-plugin/`) tells Claude to teach with a board when boxes, arrows and notes explain it better. Settings → **Diagrams & whiteboard** switches drawing and each skill on or off separately. (Lens builds a small `lens` plugin with only the skills that are on, in its data folder, and passes it with `--plugin-dir`.) Excalidraw's fonts ship with Lens in `public/excalidraw-assets/`, so boards work offline.

## Lens Review

Switch the sidebar to **Lens Review** to see your open GitHub PRs, grouped by repo. It reads GitHub through the `gh` CLI (so it uses the account `gh` is signed in with) in one GraphQL request: PRs asking for your review or your teams' review, your own PRs, mentions, and ones you commented on. It refreshes every 10 minutes, or with the ↻ button.

Each PR lands in one lane by whose move it is: **Needs you**, **Yours**, **Team**, **Waiting** (on the author, or on other approvals), **Done**, or **FYI**. The badge on the tab counts the ones that need you. Click a PR for its description, approvals vs. required, CI checks, reviews and changed files.

- **Review with Claude** starts a read-only Lens session that reviews the PR (`/code-review <number>` inside your local clone, or a gh-based review from your home folder if you don't have one). Nothing is posted to GitHub.
- **Address feedback** (your own PRs, needs a local clone) starts a session that checks out the branch, reads the review comments and failing checks, and makes the fixes. It asks before pushing.
- **Hide** removes a PR from the list in this browser.

Local clones are found from the folders your sessions run in (and one level inside them, e.g. `~/code/<repo>`).

## Marketplace

**Marketplace** (sidebar, above Settings) browses Claude Code plugins from every marketplace you've added, plus Anthropic's built-in catalogs. Search, filter by marketplace or installed / not installed, and open a plugin to see the skills inside (read from its `SKILL.md` files), everything it contains, its README, and **how many tokens it adds to every session** before you install it.

- **Add marketplace** takes a GitHub repo (`owner/repo`), a git/https URL or a folder with `.claude-plugin/marketplace.json`; for example your team's internal skills repo. Lens has no marketplaces built in; it uses `claude plugin marketplace add`, so the terminal sees the same list.
- **Install** for all your projects, or for one project (shared with the team, or only you). Plugins that ship switched off are turned on after a Lens install. Each install has an on/off switch, Uninstall and Update.
- Your own marketplaces rank above the big built-in catalogs. Plugins run code (hooks, MCP servers): install only from sources you trust.

## Settings

Open **Settings** at the bottom of the sidebar.

- **Appearance**: System (follows your Mac), Light or Dark. The button next to the logo cycles through them. The choice is saved in your browser and applied before the page paints, so there's no flash. Diagrams follow it too.

- **Account**: who the CLI is signed in as (email, org, plan). **Switch account** runs `claude auth login` in a new terminal window; **Sign out** runs `claude auth logout`.
- **Model**: the default model for replies, new sessions and sub-agents started from Lens. You can also pick a model per message next to the message box. Your terminal `claude` is not changed. In read-only (plan) mode the CLI uses at least Sonnet.
- **Auto-restore**: when a terminal session stops without closing normally (crash, closed window, reboot), Claude Code leaves its `~/.claude/sessions/<pid>.json` behind. Lens spots that and shows it in the sidebar with **Restore**, which reopens it with `claude --resume` in Terminal or iTerm. Turn on **Reopen automatically** to skip the click. This only works while Lens is running.
- **Skills**: your skills (`~/.claude/skills`) and, if you pick a project, that project's skills (`.claude/skills`). You can create, edit `SKILL.md`, turn on/off (off moves it into a `.disabled` folder the CLI doesn't load) and delete (moves it into `.trash`). Skills synced from claude.ai and plugin skills are view-only. Changes apply to new and resumed sessions.
- **Hooks**: every hook from `~/.claude/settings.json` and, if you pick a project, its `.claude/settings.json` and `.claude/settings.local.json`, grouped by event. Plugin hooks are view-only. You can add a hook (command, prompt, agent or URL; all 33 events the CLI knows), edit it as JSON, turn it off/on, delete it, or pause all hooks (the CLI's `disableAllHooks`). Hooks another app installed are marked (e.g. "added by my-tool" when its command ends in `# my-tool-hook`). Lens changes only the `hooks` key, keeps the file's formatting, refuses to write if the file changed meanwhile, and saves a backup in `~/.claude/backups` first (last 5 kept). The CLI has no per-hook off switch, so "off" parks the hook in `hooks-off.json` in Lens's data folder until you turn it back on.
- **MCP servers & connectors**: lists everything from `claude mcp list` with its status. You can add a server (HTTP, SSE or a local command, for all projects or one project folder), remove one, and sign in or out. claude.ai connectors are added and removed on claude.ai; here you can sign in to them. Connectors are grouped (connected, needs sign-in) with a search box.

The first time Lens opens a terminal window, macOS asks whether it may control Terminal (or iTerm). Click OK. If you said no, allow it in System Settings → Privacy & Security → Automation.

## Mac app

Lens can run as a normal Mac app (`Claude Lens.app`) that starts its own server, so you don't need a terminal.

```bash
cd desktop && npm install && npm run dist
```

That builds `desktop/dist/Claude Lens-<version>-arm64.dmg`. Open it and drag **Claude Lens** into Applications. The app isn't signed with an Apple developer ID, so the first time, right-click it → **Open** → **Open**.

- It runs the bundled server on `127.0.0.1:3459` with Electron's own Node, so you don't need Node installed, only Claude Code (and `gh` for Lens Review).
- It reads your login shell's `PATH` at startup, so it finds `claude`, `gh` and `git` like your terminal does.
- **Claude Lens → Open at Login** starts it when you log in. **Show Server Log** opens `~/Library/Logs/Claude Lens/server.log`.
- Lens's data (pins, settings, threads, trash) lives in `~/Library/Application Support/Claude Lens/`, shared with the dev server.
- `npm run app` in `desktop/` opens the app window on a running dev server (`http://localhost:3457`) instead, for working on Lens itself.

## Run

```bash
npm install
npm run dev -- -p 3457
```

Open http://localhost:3457. You need the `claude` CLI on your `PATH`.

## How it works

| Piece | Where |
| --- | --- |
| Reads session JSONL files | `src/lib/sessions.ts` |
| Finds and ends running sessions (`~/.claude/sessions/<pid>.json`) | `src/lib/active.ts` |
| Rename and delete | `src/lib/manage.ts` |
| Pins | `src/lib/pins.ts` → `pins.json` |
| Recent (sessions Lens used) | `src/lib/recent.ts` → `recent.json` |
| Settings (model, auto-restore, terminal) | `src/lib/settings.ts` → `settings.json` |
| Crash detection and restore | `src/lib/restore.ts` → `restore.json` |
| Skills | `src/lib/skills.ts` |
| Hooks | `src/lib/hooks.ts` |
| File panel | `src/lib/files.ts`, `src/components/FileViewer.tsx`, `FileContext.tsx`, `FileChip.tsx` |
| Marketplace (via `claude plugin`) | `src/lib/marketplace.ts`, `src/components/MarketplaceView.tsx` |
| Home dashboard and stats | `src/components/HomeView.tsx`, `src/lib/stats.ts` |
| Compact / fresh start | `src/lib/context.ts` |
| Permission prompts | `src/lib/permissions.ts`, `src/components/PermissionCard.tsx` |
| Mermaid diagrams | `src/components/Mermaid.tsx` |
| Whiteboard (Excalidraw) | `src/components/Whiteboard.tsx` |
| Built-in skills (plugin) | `lens-plugin/`, `src/lib/lensPlugin.ts` |
| Mac app (Electron) | `desktop/main.cjs`, `desktop/scripts/prepare-server.mjs` |
| Where Lens keeps its data | `src/lib/paths.ts` (`~/Library/Application Support/Claude Lens`, or `LENS_DATA_DIR`) |
| Lens Review (GitHub via `gh`) | `src/lib/github.ts` |
| Slash command list (from the CLI's start-up event) | `src/lib/commands.ts` |
| Account and MCP (via `claude auth` / `claude mcp`) | `src/lib/account.ts`, `src/lib/mcp.ts` |
| Plan limits and context window sizes | `src/lib/limits.ts` → `limits.json` |
| Stores sub-threads (a tree) | `src/lib/threads.ts` → `threads.json` in Lens's data folder |
| Runs `claude -p` and streams its output | `src/lib/runClaude.ts` |
| Folder browser for new sessions | `src/app/api/folders/route.ts` |
| Sub-agent turns / main-session turns | `src/app/api/agent/route.ts`, `src/app/api/chat/route.ts` |
| Client state for the thread tree | `src/hooks/useTreeChat.ts` |

Notes:

- Sub-agents run in **plan mode**, so they can read and search files but never change them.
- Follow-up questions in a panel use `claude --resume`, so the sub-agent remembers the thread.
- The CLI sessions that sub-agents create are hidden from the sidebar.
- The app never edits `~/.claude` itself. Replying to a session goes through the `claude` CLI, which appends to that session's file.
- **Permission prompts**: when Claude wants to run something that needs approval (a `curl`, a git command…), Lens shows a card with the exact command and **Allow once**, **Always allow in this project** (saves the CLI's own rule to that project's `.claude/settings.local.json`) or **Deny**. Unanswered questions are denied after 10 minutes. Under the hood Lens runs `claude -p --permission-prompt-tool stdio` and answers the CLI's `can_use_tool` requests on stdin.
