# Vlens

**One window onto every Claude Code session you run.** A Mac app on top of the Claude Code CLI: every session (terminal, vTower, Claude desktop app, or Vlens) in one live list, shown as a readable chat with diagrams. Answer Claude, hand a session between tools, and review your team's PRs with Claude.

It doesn't replace the CLI. It runs the same `claude`, with the same account, sessions, skills, hooks and MCP servers. What you do in Vlens, the terminal sees, and the other way round.

## Run it locally

You need an Apple Silicon Mac, [Node.js](https://nodejs.org) 20+, and the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) signed in. For PR Review you also need the [GitHub CLI](https://cli.github.com) (`gh`) signed in.

```bash
git clone https://github.com/ArunpandianMurugesan/Vlens.git
cd Vlens
npm run setup
npm run app
```

`npm run setup` installs everything once. `npm run app` opens the Vlens window with hot reload: edit `src/` and it updates. Quit the window to stop it.

Just want to use it? Download the dmg from the [latest release](https://github.com/ArunpandianMurugesan/Vlens/releases/latest). The first time you open it, click **Done** on the warning, then System Settings → Privacy & Security → **Open Anyway**. To update later, see [Updating](docs/GUIDE.md#updating).

## Features

| | |
| --- | --- |
| **Every session, live** | One sidebar for terminal, vTower, desktop-app and Vlens sessions: Pinned, Sessions (by folder or as one list) and Archived, with a dot for working vs waiting for you. |
| **Chat like the terminal** | Permission prompts with the same choices, plan approval, Claude's questions, all five permission modes (Shift+Tab), type ahead while Claude works. |
| **Hand off** | **Take over here** from a terminal or the desktop app, **Continue in terminal** from Vlens, or switch a session to the **CLI** view (the real `claude --resume`). One writer at a time, same conversation. |
| **Visual replies** | Mermaid diagrams, an Excalidraw whiteboard, and a file panel that jumps to the changed lines. |
| **Terminal** | A real shell in the session's folder beside the chat (**Terminal** button or Ctrl+`), with terminal profiles (colours, font, cursor). |
| **Sessions your way** | Fork, Archive (⌘⌫), Reload, a new session in its own git worktree, ⌘K quick switcher, and an Inspector with context, changed files and plan usage. |
| **History** | The last 15 days, day by day, with Resume here / Terminal. Crashed sessions come back with Restore. |
| **Home** | Start a session in any folder, see what needs you and what's running, today's numbers, and heavy sessions with Compact / Fresh start. |
| **Notifications and menu bar** | Desktop alerts when Claude asks, has a plan, or finishes (terminal sessions too). The menu bar icon lists what's waiting and can Allow / Deny a permission. |
| **PR Review** | Your GitHub PRs (New, My PRs, Needs my review), one page per PR, a risk score, Review with Claude, Address feedback and Merge. |
| **Autopilot** | Off by default. Reviews PRs for you on a schedule, as drafts you post, within limits you set. |
| **Settings and Marketplace** | Account, model, skills, hooks, MCP servers in one place, plus your team's skills. |
| **Get started** | First launch installs Claude Code, signs you in and connects GitHub. |

Vlens only posts to GitHub from your own `gh` account, when you click (it asks first), or when you set an Autopilot workflow to post. It never approves a PR. Details: [What Vlens can do on GitHub as you](docs/GUIDE.md#what-vlens-can-do-on-github-as-you).

## How it's different

| | Terminal | vTower | Claude desktop app | **Vlens** |
| --- | --- | --- | --- | --- |
| Sees sessions from other tools, live | No | Its own tabs | Its own sessions | **All of them** |
| Moves a session between tools | `claude --resume` by hand | No | No | **One click** |
| PR board | `gh` by hand | No | Its own sessions | **All your PRs, with Claude reviews** |

vTower and Vlens work together: type in vTower's terminals, and see and review in Vlens. The full comparison is in the guide.

## More

- [docs/GUIDE.md](docs/GUIDE.md): the problems it solves, the full comparison, every feature in detail, PR Review and Autopilot, updating, building the dmg, releasing, and how the code is laid out.
- [CHANGELOG.md](CHANGELOG.md): what changed in each version.
