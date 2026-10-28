# Vlens

**One window onto every Claude Code session you run.** Vlens is a Mac app that sits on top of the Claude Code CLI: it shows every session (terminal, vTower, Claude desktop app, or started in Vlens) in one live list, renders them as a readable chat with diagrams, and lets you answer Claude, hand a session back and forth, and learn from past sessions.

It doesn't replace the CLI. It runs the same `claude` command, uses the same account, the same `~/.claude` sessions, skills, hooks and MCP servers. Anything you do in Vlens, the terminal sees, and the other way round.

**Download:** [latest release](https://github.com/ArunpandianMurugesan/Vlens/releases/latest) (Apple Silicon Mac). Open the dmg and drag Vlens into Applications. The first time, open Vlens, click **Done** on the warning, then go to System Settings → Privacy & Security and click **Open Anyway** (the app isn't notarized by Apple yet, so macOS asks once). The **Get started** page then installs Claude Code, signs you in, and connects GitHub. What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

## The problems it solves

Claude Code is great, but a working day with it looks like eight terminal tabs and a lot of scrolling.

| Problem | What it feels like | How Vlens fixes it |
| --- | --- | --- |
| **Lost in tabs** | Which tab was the pixel fix? Which one is waiting for me? | One sidebar with every session, grouped by folder, with a dot for "working" vs "waiting for you". Sessions you open in a terminal show up live. |
| **Walls of text** | Flows, architectures and plans come back as long text. | Replies render as a chat: markdown, tool calls you can expand, Mermaid diagrams, a teaching whiteboard, and a file panel for every edit. |
| **Missing the moment Claude needs you** | A permission prompt sat unanswered for 20 minutes in a hidden tab. | Permission, question and plan cards with the terminal's exact choices, plus desktop notifications. |
| **Sessions you forgot** | "I worked on that three days ago, which session was it?" | History: the last 15 days, day by day, with Resume here / Terminal. Crashed sessions are offered back with Restore. |
| **Hidden limits and context** | You hit the 5-hour limit, or a session got slow and expensive. | Home shows 5-hour and weekly limits, tokens per day, and your heaviest sessions with Compact and Fresh start. |
| **The same mistakes again** | Claude keeps making the same wrong move across sessions. | Coach and Retro: spot error streaks and corrections, turn them into one-line lessons, and write them to `CLAUDE.md` so every Claude (terminal and desktop too) learns. |
| **Setup scattered across files** | Skills, hooks and MCP servers live in different JSON files. | One Settings page for account, model, skills, hooks, MCP servers, notifications and the coach, plus a Marketplace for your team's skills. |
| **PR reviews in another tool** | Review requests live on GitHub, the work lives in Claude. | Vlens Review: your PRs by "whose move it is", with one-click Review with Claude and Address feedback sessions. |

## How Vlens is different

There are already three good ways to work with Claude Code. Vlens is the layer that ties them together.

| | Terminal (`claude`) | vTower | Claude desktop app | **Vlens** |
| --- | --- | --- | --- | --- |
| **What it is** | The CLI itself | A multi-tab terminal that shows which agent needs you | Anthropic's app with chat and a Code tab | A visual window over all your Claude Code sessions |
| **Best at** | Speed, every CLI feature | Running many terminal sessions, attention alerts, limits in the status line | A polished chat for the sessions it starts | Seeing, answering and reviewing everything in one place |
| **Sees sessions from other tools, live** | No, one session per tab | Its own tabs | Its own sessions | **Yes**: terminal, vTower, desktop app and Vlens, in one list |
| **Move a session between tools** | `claude --resume` by hand | No | No | **Take over here** / **Continue in terminal**, one writer at a time |
| **Output** | Text | Text | Rich chat | Rich chat, **Mermaid diagrams, Excalidraw whiteboard**, file panel with the changed lines |
| **Prompts (permissions, questions, plans)** | Yes | Yes (it's a terminal) | Yes | Yes, same choices as the terminal (keys 1–3, Esc, Shift+Tab modes) |
| **History of closed sessions** | `claude --resume` picker | No | Its own sessions | **15 days by day**, with resume in Vlens or the terminal |
| **Learns from your mistakes** | `CLAUDE.md` you write, auto memory | Same as the CLI | Same as the CLI | Adds **Coach + Retro**: spots error streaks and corrections across sessions, suggests lessons, writes the ones you approve to `CLAUDE.md` |
| **Limits and context health** | `/usage`, `/context` | Status line | Settings | **Home dashboard**: limits, tokens per day, heaviest sessions with Compact / Fresh start |
| **Team tools** | `gh` by hand | No | PR status for its own sessions | **Vlens Review** (all your PRs by whose move it is) and a skills **Marketplace** |
| **Skills, hooks, MCP** | Edit JSON files | No | Partly | One Settings page, writes the same files the CLI reads |

**Vlens and vTower work together.** vTower is where you type in terminals; Vlens is where you see every session at once, read the diagrams, review the plan and learn from it. A session you open in a vTower tab shows up in Vlens's sidebar live (before its first message, too), Vlens's notifications cover it when it goes from working to waiting, and the Hooks page marks the hooks vTower installed so you don't edit them by accident. If you want to keep typing in Vlens instead, **Take over here** ends the terminal process and continues the same conversation.

**Why not just the desktop app?** Use it if all your work starts there. Vlens is for when your sessions are spread across terminals, vTower and the app: it reads them all from `~/.claude`, so nothing has to start in Vlens to show up in Vlens.

## All features

- **Home dashboard**: what Vlens opens to (click the logo to come back). Who you're signed in as, your 5-hour and weekly limits, sessions running and used this week, messages and tokens today, and a 14-day activity chart (tokens read or messages; hover for numbers, or switch to a table).
- **Coach** (Home): "Fix this now" cards from this week's sessions (tool-error streaks, corrections, huge pastes, files Claude keeps re-reading, sessions used for days on end), each with Open session / Retro / Add as lesson. **Retro** has a small model review a digest of a session (your messages, corrections, errors; not the whole history) and suggest what went well, what cost time, and one-line lessons. **Apply** writes a lesson into a block Vlens owns at the end of the project's `CLAUDE.md` or `~/.claude/CLAUDE.md`, so the terminal and desktop app learn too; your own lines are never touched, and Take out / Delete rewrite only that block. Settings → Coach turns each part on or off.
- **Context health**: every reply re-sends the whole session, so long sessions burn your limits fastest. The dashboard shows how many tokens Claude read vs. wrote today and lists your heaviest sessions with two fixes: **Compact** (runs `/compact`) and **Fresh start** (Claude writes a handoff note, then a new session in the same folder starts from it). Both are disabled for sessions that are open in a terminal or the desktop app. Compactions show in a session as a "Conversation compacted" divider you can expand.
- **Sidebar**: shows **Active** sessions, meaning ones open in a running Claude Code process (terminal or desktop app), plus **Pinned** ones, the session you have open, and **Recent**: sessions Vlens started or replied in during the last 24 hours (their `claude -p` process exits after each reply, so they'd otherwise drop off). Remove one with ⋯ → Remove from Recent. A solid green dot means it's working, a hollow dot means it's waiting for you. Refreshes every 5s.
- **Session menu** (`⋯` on each item): **Rename** (the same as `/rename`, so the CLI sees it), **Pin / Unpin**, **End session** (stops the Claude CLI process; desktop-app sessions have to be ended in the app), and **Delete** (only once it's stopped; files move to Vlens's `trash/` folder, so you can move them back to `~/.claude/projects/<project>/`).
- **Usage**: the bottom of the sidebar shows your plan's **5-hour** and **weekly** limits (how much is used and when each resets). Each session shows how full its **context window** is, in the bar and in the header. Limits update whenever Vlens runs Claude; the refresh button sends one tiny Haiku request (about $0.0004). The page refreshes on its own only when the data is over 15 minutes old.
- **Chat view**: renders a session like a chat (markdown, thinking, tool calls with their output). A session that's still running in the terminal updates live.
- **Claude's questions**: when Claude asks you something (its multiple-choice question tool), Vlens shows the options as a card: pick one or more, or type your own under Other, then **Send**. Earlier questions show what you picked. For a session open in a terminal, answer there; Vlens shows the question and your answer once it's in.
- **Permission modes**: the picker under the message box has the CLI's five modes (Ask before edits, Accept edits, Plan mode, Auto mode, Bypass permissions) and starts in your terminal's default (`permissions.defaultMode` in `~/.claude/settings.json`). Shift+Tab in the message box cycles them, like the terminal.
- **Permission prompts** offer the terminal's choices: Yes, Yes and don't ask again (showing the rule it saves), and No with a note telling Claude what to do instead. Keys 1-3 pick, Esc stops.
- **Plan approval**: when Claude finishes a plan, Vlens shows it with Yes + auto mode / auto-accept edits / manually approve edits, or No, keep planning. Vlens switches to the mode you picked.
- **Type ahead**: send while Claude is working and the message waits above the box, then goes out when Claude is done (several are sent together). Stopping the reply pauses them.
- **History**: the sidebar's History page lists sessions you closed in the last 15 days, by day, with search. **Resume here** opens one in Vlens (type to carry on), **Terminal** continues it with `claude --resume`, and the pin keeps it in the sidebar.
- **Desktop notifications**: when Claude asks permission, asks a question, has a plan ready or finishes, and you're in another window. Terminal and desktop-app sessions notify when they go from working to waiting. Click one to open that session. Turn it off in Settings → Notifications.
- **One writer at a time**: a running `claude` keeps the conversation in memory, so Vlens can't type into it, and replying from Vlens would split the session. While a session is open in a terminal or the desktop app, Vlens shows it live but swaps the message box for a banner: type there, or click **Take over here** (terminal sessions only) to end that process and continue in Vlens. Going the other way, **Continue in terminal** in the chat header opens `claude --resume` in Terminal or iTerm.
- **New session**: click **New session**, pick a folder (a recent project folder, browse, or type a path like `~/Desktop/app`), and type the first message. It starts a real `claude` session there, the same as running `claude` in that folder.
- **File panel**: when Claude writes or edits a file, the reply shows a chip like `step1_basics.py +59 −0`; click it (or any file path in a reply, or the ↗ on a Read row) to open the file beside the chat. Tabs, a clickable folder breadcrumb, line numbers and syntax highlighting (Shiki, following the Vlens theme). Opening from an edit highlights and scrolls to the changed lines. Markdown has Preview / Code, images preview, folders list their files. Buttons: reload, copy path, open in VS Code at that line, reveal in Finder, full width. Only files in your home folder open, and never folders like `~/.ssh` or `~/.aws`.
- **Message box**: paste, drop or 📎 attach images (PNG, JPEG, GIF, WebP; large ones are scaled down). Type `/` for a menu of slash commands and skills for that folder (arrow keys + Enter or Tab to pick). Commands you ran in a terminal, like `/compact`, show up in the chat with their output.
- **Reply to a session**: type at the bottom to continue the session with `claude --resume`. The reply is saved in the same session file, so the CLI sees it too. Pick **Can edit files** or **Read-only** under the box.
- **Sub-agents**: select any text in an answer and click **Ask Sub-Agent**. A panel slides in and runs a real `claude -p` in that session's project folder, focused on the snippet. Sub-agents are one level deep: a side question about the main session, not a chain.
- **Terminal console**: the bottom of each panel shows the real commands the sub-agent ran.

## Flow diagrams (built in)

Replies that contain a ```` ```mermaid ```` block are drawn as diagrams (flowcharts, sequence, state, ER, timeline…), in light or dark to match your system, with **code / copy / full screen** buttons. Arrows marked `animate: true` in the diagram move; Settings can animate every arrow.

Vlens also ships its own Claude Code plugin in [`lens-plugin/`](lens-plugin) with a **`lens:diagrams`** skill that tells Claude when and how to draw a diagram. Vlens passes it with `--plugin-dir` only to the runs it starts, so your terminal `claude` doesn't get it. Settings → **Flow diagrams** turns drawing, animate-every-arrow and the skill on or off separately. More built-in skills can go in the same plugin.

## Whiteboard (built in)

**Mermaid or whiteboard?** Mermaid is for flowcharts and structured diagrams (flows, sequences, states, schemas, timelines): the default for any flow. The Excalidraw whiteboard is for teaching: when you ask Claude to teach or walk you through something and notes, groupings or comparisons matter more than exact shapes. The two built-in skills tell Claude which to use, and not to draw the same thing twice.

Replies with an ```` ```excalidraw ```` block (a JSON list of simple shapes, labels and arrows) are drawn as hand-drawn [Excalidraw](https://excalidraw.com) boards. **Open board** makes it a full editable whiteboard: move things, draw, add notes, export PNG or `.excalidraw`. Every Mermaid diagram also gets an **Open on whiteboard** button that converts it into editable shapes.

The built-in **`lens:whiteboard`** skill (in `lens-plugin/`) tells Claude to teach with a board when boxes, arrows and notes explain it better. Settings → **Diagrams & whiteboard** switches drawing and each skill on or off separately. (Vlens builds a small `lens` plugin with only the skills that are on, in its data folder, and passes it with `--plugin-dir`.) Excalidraw's fonts ship with Vlens in `public/excalidraw-assets/`, so boards work offline.

## Vlens Review

Switch the sidebar to **Vlens Review** to see your open GitHub PRs, grouped by repo. It reads GitHub through the `gh` CLI (so it uses the account `gh` is signed in with) in one GraphQL request: PRs asking for your review or your teams' review, your own PRs, mentions, and ones you commented on. It refreshes every 10 minutes, or with the ↻ button.

Each PR lands in one lane by whose move it is: **Needs you**, **Yours**, **Team**, **Waiting** (on the author, or on other approvals), **Done**, or **FYI**. The badge on the tab counts the ones that need you. Click a PR for its description, approvals vs. required, CI checks, reviews and changed files.

- **Review with Claude** starts a read-only Vlens session that reviews the PR (`/code-review <number>` inside your local clone, or a gh-based review from your home folder if you don't have one). Nothing is posted to GitHub.
- **Address feedback** (your own PRs, needs a local clone) starts a session that checks out the branch, reads the review comments and failing checks, and makes the fixes. It asks before pushing.
- **Hide** removes a PR from the list in this browser.

Local clones are found from the folders your sessions run in (and one level inside them, e.g. `~/code/<repo>`).

## Marketplace

**Marketplace** (sidebar, above Settings) browses Claude Code plugins from every marketplace you've added, plus Anthropic's built-in catalogs. Search, filter by marketplace or installed / not installed, and open a plugin to see the skills inside (read from its `SKILL.md` files), everything it contains, its README, and **how many tokens it adds to every session** before you install it.

- **Add marketplace** takes a GitHub repo (`owner/repo`), a git/https URL or a folder with `.claude-plugin/marketplace.json`; for example your team's internal skills repo. Vlens has no marketplaces built in; it uses `claude plugin marketplace add`, so the terminal sees the same list.
- **Install** for all your projects, or for one project (shared with the team, or only you). Plugins that ship switched off are turned on after a Vlens install. Each install has an on/off switch, Uninstall and Update.
- Your own marketplaces rank above the big built-in catalogs. Plugins run code (hooks, MCP servers): install only from sources you trust.

## Settings

Open **Settings** at the bottom of the sidebar.

- **Appearance**: System (follows your Mac), Light or Dark. The button next to the logo cycles through them. The choice is saved in your browser and applied before the page paints, so there's no flash. Diagrams follow it too.

- **Account**: who the CLI is signed in as (email, org, plan). **Switch account** runs `claude auth login` in a new terminal window; **Sign out** runs `claude auth logout`.
- **Model**: the default model for replies, new sessions and sub-agents started from Vlens. You can also pick a model per message next to the message box. Your terminal `claude` is not changed. In read-only (plan) mode the CLI uses at least Sonnet.
- **Auto-restore**: when a terminal session stops without closing normally (crash, closed window, reboot), Claude Code leaves its `~/.claude/sessions/<pid>.json` behind. Vlens spots that and shows it in the sidebar with **Restore**, which reopens it with `claude --resume` in Terminal or iTerm. Turn on **Reopen automatically** to skip the click. This only works while Vlens is running.
- **Skills**: your skills (`~/.claude/skills`) and, if you pick a project, that project's skills (`.claude/skills`). You can create, edit `SKILL.md`, turn on/off (off moves it into a `.disabled` folder the CLI doesn't load) and delete (moves it into `.trash`). Skills synced from claude.ai and plugin skills are view-only. Changes apply to new and resumed sessions.
- **Hooks**: every hook from `~/.claude/settings.json` and, if you pick a project, its `.claude/settings.json` and `.claude/settings.local.json`, grouped by event. Plugin hooks are view-only. You can add a hook (command, prompt, agent or URL; all 33 events the CLI knows), edit it as JSON, turn it off/on, delete it, or pause all hooks (the CLI's `disableAllHooks`). Hooks another app installed are marked (e.g. "added by my-tool" when its command ends in `# my-tool-hook`). Vlens changes only the `hooks` key, keeps the file's formatting, refuses to write if the file changed meanwhile, and saves a backup in `~/.claude/backups` first (last 5 kept). The CLI has no per-hook off switch, so "off" parks the hook in `hooks-off.json` in Vlens's data folder until you turn it back on.
- **MCP servers & connectors**: lists everything from `claude mcp list` with its status. You can add a server (HTTP, SSE or a local command, for all projects or one project folder), remove one, and sign in or out. claude.ai connectors are added and removed on claude.ai; here you can sign in to them. Connectors are grouped (connected, needs sign-in) with a search box.

The first time Vlens opens a terminal window, macOS asks whether it may control Terminal (or iTerm). Click OK. If you said no, allow it in System Settings → Privacy & Security → Automation.

## Releasing a new version

1. Bump [`VERSION`](VERSION) (`1.1.0` → `1.1.1` for fixes, `1.2.0` for features, `2.0.0` for big changes).
2. Add a `## <version> — <date>` section at the top of [CHANGELOG.md](CHANGELOG.md) with what changed.
3. Run `npm run release -- --dry`: it syncs the version into both `package.json` files and shows the notes. Commit and push.
4. Run `npm run release`: it builds the dmg, tags `v<version>`, and publishes a GitHub release with the dmg attached. `gh` has to be signed in to an account that can publish to this repo (or set `GH_TOKEN`).

## Mac app

Vlens can run as a normal Mac app (`Vlens.app`) that starts its own server, so you don't need a terminal.

**Get started**: the first time Vlens opens (or whenever Claude Code is missing or signed out) it shows a setup page with three steps: install Claude Code, sign in to Claude, and optionally connect GitHub for Vlens Review. Each button runs the step in a Terminal window, and the page ticks it off once it's done. So you can hand the dmg to another dev and they're set up in a couple of minutes.

```bash
cd desktop && npm install && npm run dist
```

That builds `desktop/dist/Vlens-<version>-arm64.dmg`. Open it and drag **Vlens** into Applications. The app is only ad-hoc signed (no Apple developer ID), so the first time, open it, click **Done** on the warning, then System Settings → Privacy & Security → **Open Anyway**.

If macOS says the app is **damaged** (a Claude Lens 1.0.0 dmg), run `xattr -dr com.apple.quarantine "/Applications/Claude Lens.app"` once, then open it.

- It runs the bundled server on `127.0.0.1:3459` with Electron's own Node, so you don't need Node installed, only Claude Code (and `gh` for Vlens Review).
- It reads your login shell's `PATH` at startup, so it finds `claude`, `gh` and `git` like your terminal does.
- **Vlens → Open at Login** starts it when you log in. **Show Server Log** opens `~/Library/Logs/Vlens/server.log`.
- Vlens's data (pins, settings, threads, trash) lives in `~/Library/Application Support/Vlens/`, shared with the dev server. If you used Claude Lens before, its folder is moved here the first time Vlens starts.
- `npm run app` in `desktop/` opens the app window on a running dev server (`http://localhost:3457`) instead, for working on Vlens itself.

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
| Recent (sessions Vlens used) | `src/lib/recent.ts` → `recent.json` |
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
| Where Vlens keeps its data | `src/lib/paths.ts` (`~/Library/Application Support/Vlens`, or `LENS_DATA_DIR`) |
| Vlens Review (GitHub via `gh`) | `src/lib/github.ts` |
| Slash command list (from the CLI's start-up event) | `src/lib/commands.ts` |
| Account and MCP (via `claude auth` / `claude mcp`) | `src/lib/account.ts`, `src/lib/mcp.ts` |
| Plan limits and context window sizes | `src/lib/limits.ts` → `limits.json` |
| Stores sub-threads (a tree) | `src/lib/threads.ts` → `threads.json` in Vlens's data folder |
| Runs `claude -p` and streams its output | `src/lib/runClaude.ts` |
| Folder browser for new sessions | `src/app/api/folders/route.ts` |
| Sub-agent turns / main-session turns | `src/app/api/agent/route.ts`, `src/app/api/chat/route.ts` |
| Client state for the thread tree | `src/hooks/useTreeChat.ts` |

Notes:

- Sub-agents run in **plan mode**, so they can read and search files but never change them.
- Follow-up questions in a panel use `claude --resume`, so the sub-agent remembers the thread.
- The CLI sessions that sub-agents create are hidden from the sidebar.
- The app never edits `~/.claude` itself. Replying to a session goes through the `claude` CLI, which appends to that session's file.
- **Permission prompts**: when Claude wants to run something that needs approval (a `curl`, a git command…), Vlens shows a card with the exact command and **Allow once**, **Always allow in this project** (saves the CLI's own rule to that project's `.claude/settings.local.json`) or **Deny**. Unanswered questions are denied after 10 minutes. Under the hood Vlens runs `claude -p --permission-prompt-tool stdio` and answers the CLI's `can_use_tool` requests on stdin.
