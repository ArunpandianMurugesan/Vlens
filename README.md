# Vlens

**One window onto every Claude Code session you run.** A Mac app on top of the Claude Code CLI: every session (terminal, vTower, Claude desktop app, or Vlens) in one live list, shown as a readable chat with diagrams. Answer Claude, hand a session between tools, and learn from past sessions.

It doesn't replace the CLI. It runs the same `claude`, with the same account, sessions, skills, hooks and MCP servers. What you do in Vlens, the terminal sees, and the other way round.

## Run it locally

You need an Apple Silicon Mac, [Node.js](https://nodejs.org) 20+, and the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) signed in.

```bash
git clone https://github.com/ArunpandianMurugesan/Vlens.git
cd Vlens
npm run setup
npm run app
```

`npm run setup` installs everything once. `npm run app` opens the Vlens window with hot reload: edit `src/` and it updates. Quit the window to stop it.

Just want to use it? Download the dmg from the [latest release](https://github.com/ArunpandianMurugesan/Vlens/releases/latest). The first time you open it, click **Done** on the warning, then System Settings → Privacy & Security → **Open Anyway**.

## Features

| | |
| --- | --- |
| **Every session, live** | One sidebar for terminal, vTower, desktop-app and Vlens sessions, grouped by folder, with a dot for working vs waiting for you. |
| **Chat like the terminal** | Permission prompts with the same choices, plan approval, Claude's questions, all five permission modes (Shift+Tab), type ahead while Claude works. |
| **Hand off** | **Take over here** from a terminal, or **Continue in terminal** from Vlens. One writer at a time, same conversation. |
| **Visual replies** | Mermaid diagrams, an Excalidraw whiteboard, and a file panel that jumps to the changed lines. |
| **History** | The last 15 days, day by day, with Resume here / Terminal. Crashed sessions come back with Restore. |
| **Notifications** | When Claude asks, has a plan, or finishes, for terminal sessions too. |
| **Home and Coach** | 5-hour and weekly limits, context health with Compact / Fresh start, and a coach that turns session retros into lessons in `CLAUDE.md`. |
| **Vlens Review** | Your GitHub PRs by whose move it is, with one-click Review with Claude and Address feedback. |
| **Settings and Marketplace** | Account, model, skills, hooks, MCP servers in one place, plus your team's skills. |
| **Get started** | First launch installs Claude Code, signs you in and connects GitHub. |

## How it's different

| | Terminal | vTower | Claude desktop app | **Vlens** |
| --- | --- | --- | --- | --- |
| Sees sessions from other tools, live | No | Its own tabs | Its own sessions | **All of them** |
| Moves a session between tools | `claude --resume` by hand | No | No | **One click** |
| Learns from your sessions | `CLAUDE.md`, auto memory | Same as the CLI | Same as the CLI | **Adds retros and lessons you approve** |
| PR board | `gh` by hand | No | Its own sessions | **All your PRs** |

vTower and Vlens work together: type in vTower's terminals, and see, review and learn in Vlens. The full comparison is in the guide.

## More

- [docs/GUIDE.md](docs/GUIDE.md): the problems it solves, the full comparison, every feature in detail, building the dmg, releasing, and how the code is laid out.
- [CHANGELOG.md](CHANGELOG.md): what changed in each version.
