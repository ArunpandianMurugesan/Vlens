# Claude Lens

A web UI for your Claude Code CLI sessions, with nested sub-agent threads.

- **Sidebar**: every session in `~/.claude/projects`, newest first, with search and a project filter. Refreshes every 5s.
- **Chat view**: renders a session like a chat (markdown, thinking, tool calls with their output). A session that's still running in the terminal updates live.
- **Sub-agents**: select any text in an answer and click **Ask Sub-Agent**. A panel slides in and runs a real `claude -p` in that session's project folder, focused on the snippet. You can select text inside a sub-agent answer to go one level deeper, as many times as you like.
- **Terminal console**: the bottom of each panel shows the real commands the sub-agent ran.

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
| Stores sub-threads (a tree) | `src/lib/threads.ts` → `data/threads.json` |
| Runs the sub-agent and streams it | `src/app/api/agent/route.ts` |
| Client state for the thread tree | `src/hooks/useTreeChat.ts` |

Notes:

- Sub-agents run in **plan mode**, so they can read and search files but never change them.
- Follow-up questions in a panel use `claude --resume`, so the sub-agent remembers the thread.
- The CLI sessions that sub-agents create are hidden from the sidebar.
- The app only reads `~/.claude`; it never writes there.
