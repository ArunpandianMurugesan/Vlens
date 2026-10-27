# Claude Lens

A web UI for your Claude Code CLI sessions, with nested sub-agent threads.

- **Sidebar**: shows **Active** sessions, meaning ones open in a running Claude Code process (terminal or desktop app), plus **Pinned** ones and the session you have open. A solid green dot means it's working, a hollow dot means it's waiting for you. Refreshes every 5s.
- **Session menu** (`⋯` on each item): **Rename** (the same as `/rename`, so the CLI sees it), **Pin / Unpin**, **End session** (stops the Claude CLI process; desktop-app sessions have to be ended in the app), and **Delete** (only once it's stopped; files move to `data/trash/`, so you can move them back to `~/.claude/projects/<project>/`).
- **Usage**: the bottom of the sidebar shows your plan's **5-hour** and **weekly** limits (how much is used and when each resets). Each session shows how full its **context window** is, in the bar and in the header. Limits update whenever Lens runs Claude; the refresh button sends one tiny Haiku request (about $0.0004). The page refreshes on its own only when the data is over 15 minutes old.
- **Chat view**: renders a session like a chat (markdown, thinking, tool calls with their output). A session that's still running in the terminal updates live.
- **New session**: click **New session**, pick a folder (a recent project folder, browse, or type a path like `~/Desktop/app`), and type the first message. It starts a real `claude` session there, the same as running `claude` in that folder.
- **Message box**: paste, drop or 📎 attach images (PNG, JPEG, GIF, WebP; large ones are scaled down). Type `/` for a menu of slash commands and skills for that folder (arrow keys + Enter or Tab to pick). Commands you ran in a terminal, like `/compact`, show up in the chat with their output.
- **Reply to a session**: type at the bottom to continue the session with `claude --resume`. The reply is saved in the same session file, so the CLI sees it too. Pick **Can edit files** or **Read-only** under the box.
- **Sub-agents**: select any text in an answer and click **Ask Sub-Agent**. A panel slides in and runs a real `claude -p` in that session's project folder, focused on the snippet. You can select text inside a sub-agent answer to go one level deeper, as many times as you like.
- **Terminal console**: the bottom of each panel shows the real commands the sub-agent ran.

## Lens Review

Switch the sidebar to **Lens Review** to see your open GitHub PRs, grouped by repo. It reads GitHub through the `gh` CLI (so it uses the account `gh` is signed in with) in one GraphQL request: PRs asking for your review or your teams' review, your own PRs, mentions, and ones you commented on. It refreshes every 10 minutes, or with the ↻ button.

Each PR lands in one lane by whose move it is: **Needs you**, **Yours**, **Team**, **Waiting** (on the author, or on other approvals), **Done**, or **FYI**. The badge on the tab counts the ones that need you. Click a PR for its description, approvals vs. required, CI checks, reviews and changed files.

- **Review with Claude** starts a read-only Lens session that reviews the PR (`/code-review <number>` inside your local clone, or a gh-based review from your home folder if you don't have one). Nothing is posted to GitHub.
- **Address feedback** (your own PRs, needs a local clone) starts a session that checks out the branch, reads the review comments and failing checks, and makes the fixes. It asks before pushing.
- **Hide** removes a PR from the list in this browser.

Local clones are found from the folders your sessions run in (and one level inside them, e.g. `~/code/<repo>`).

## Settings

Open **Settings** at the bottom of the sidebar.

- **Account**: who the CLI is signed in as (email, org, plan). **Switch account** runs `claude auth login` in a new terminal window; **Sign out** runs `claude auth logout`.
- **Model**: the default model for replies, new sessions and sub-agents started from Lens. You can also pick a model per message next to the message box. Your terminal `claude` is not changed. In read-only (plan) mode the CLI uses at least Sonnet.
- **Auto-restore**: when a terminal session stops without closing normally (crash, closed window, reboot), Claude Code leaves its `~/.claude/sessions/<pid>.json` behind. Lens spots that and shows it in the sidebar with **Restore**, which reopens it with `claude --resume` in Terminal or iTerm. Turn on **Reopen automatically** to skip the click. This only works while Lens is running.
- **Skills**: your skills (`~/.claude/skills`) and, if you pick a project, that project's skills (`.claude/skills`). You can create, edit `SKILL.md`, turn on/off (off moves it into a `.disabled` folder the CLI doesn't load) and delete (moves it into `.trash`). Skills synced from claude.ai and plugin skills are view-only. Changes apply to new and resumed sessions.
- **Hooks**: every hook from `~/.claude/settings.json` and, if you pick a project, its `.claude/settings.json` and `.claude/settings.local.json`, grouped by event. Plugin hooks are view-only. You can add a hook (command, prompt, agent or URL; all 33 events the CLI knows), edit it as JSON, turn it off/on, delete it, or pause all hooks (the CLI's `disableAllHooks`). Hooks another app installed are marked (e.g. "added by my-tool" when its command ends in `# my-tool-hook`). Lens changes only the `hooks` key, keeps the file's formatting, refuses to write if the file changed meanwhile, and saves a backup in `~/.claude/backups` first (last 5 kept). The CLI has no per-hook off switch, so "off" parks the hook in `data/hooks-off.json` until you turn it back on.
- **MCP servers & connectors**: lists everything from `claude mcp list` with its status. You can add a server (HTTP, SSE or a local command, for all projects or one project folder), remove one, and sign in or out. claude.ai connectors are added and removed on claude.ai; here you can sign in to them. Connectors are grouped (connected, needs sign-in) with a search box.

The first time Lens opens a terminal window, macOS asks whether it may control Terminal (or iTerm). Click OK. If you said no, allow it in System Settings → Privacy & Security → Automation.

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
| Pins | `src/lib/pins.ts` → `data/pins.json` |
| Settings (model, auto-restore, terminal) | `src/lib/settings.ts` → `data/settings.json` |
| Crash detection and restore | `src/lib/restore.ts` → `data/restore.json` |
| Skills | `src/lib/skills.ts` |
| Hooks | `src/lib/hooks.ts` |
| Lens Review (GitHub via `gh`) | `src/lib/github.ts` |
| Slash command list (from the CLI's start-up event) | `src/lib/commands.ts` |
| Account and MCP (via `claude auth` / `claude mcp`) | `src/lib/account.ts`, `src/lib/mcp.ts` |
| Plan limits and context window sizes | `src/lib/limits.ts` → `data/limits.json` |
| Stores sub-threads (a tree) | `src/lib/threads.ts` → `data/threads.json` |
| Runs `claude -p` and streams its output | `src/lib/runClaude.ts` |
| Folder browser for new sessions | `src/app/api/folders/route.ts` |
| Sub-agent turns / main-session turns | `src/app/api/agent/route.ts`, `src/app/api/chat/route.ts` |
| Client state for the thread tree | `src/hooks/useTreeChat.ts` |

Notes:

- Sub-agents run in **plan mode**, so they can read and search files but never change them.
- Follow-up questions in a panel use `claude --resume`, so the sub-agent remembers the thread.
- The CLI sessions that sub-agents create are hidden from the sidebar.
- The app never edits `~/.claude` itself. Replying to a session goes through the `claude` CLI, which appends to that session's file.
- In **Can edit files** mode, Bash and other tools only run if your Claude Code permission settings already allow them, since there's no one to answer a prompt.
