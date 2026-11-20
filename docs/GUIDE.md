# Vlens guide

Everything that isn't in the [README](../README.md): why Vlens exists, how it compares, every feature in detail, building, releasing, and how the code is laid out.

## The problems it solves

Claude Code is great, but a working day with it looks like eight terminal tabs and a lot of scrolling.

| Problem | What it feels like | How Vlens fixes it |
| --- | --- | --- |
| **Lost in tabs** | Which tab was the pixel fix? Which one is waiting for me? | One sidebar with every session, grouped by folder, with a dot for "working" vs "waiting for you". Sessions you open in a terminal show up live. |
| **Walls of text** | Flows, architectures and plans come back as long text. | Replies render as a chat: markdown, tool calls you can expand, Mermaid diagrams, a teaching whiteboard, and a file panel for every edit. |
| **Missing the moment Claude needs you** | A permission prompt sat unanswered for 20 minutes in a hidden tab. | Permission, question and plan cards with the terminal's exact choices, desktop notifications, and a menu bar icon that lists what's waiting. |
| **Sessions you forgot** | "I worked on that three days ago, which session was it?" | History: the last 15 days, day by day, with Resume here / Terminal. Crashed sessions are offered back with Restore. ⌘K finds any session. |
| **Hidden limits and context** | You hit the 5-hour limit, or a session got slow and expensive. | Home and the sidebar show 5-hour and weekly limits. Home lists heavy sessions with Compact and Fresh start. |
| **Setup scattered across files** | Skills, hooks and MCP servers live in different JSON files. | One Settings page for account, model, skills, hooks, MCP servers and notifications, plus a Marketplace for your team's skills. |
| **PR reviews in another tool** | Review requests live on GitHub, the work lives in Claude. | PR Review: your PRs by whose move it is, one page per PR, Review with Claude, Address feedback, and follow-up reviews that track each PR until it's merged. |

## How Vlens is different

There are already three good ways to work with Claude Code. Vlens is the layer that ties them together.

| | Terminal (`claude`) | vTower | Claude desktop app | **Vlens** |
| --- | --- | --- | --- | --- |
| **What it is** | The CLI itself | A multi-tab terminal that shows which agent needs you | Anthropic's app with chat and a Code tab | A visual window over all your Claude Code sessions |
| **Best at** | Speed, every CLI feature | Running many terminal sessions, attention alerts, limits in the status line | A polished chat for the sessions it starts | Seeing, answering and reviewing everything in one place |
| **Sees sessions from other tools, live** | No, one session per tab | Its own tabs | Its own sessions | **Yes**: terminal, vTower, desktop app and Vlens, in one list |
| **Move a session between tools** | `claude --resume` by hand | No | No | **Take over here** / **Continue in terminal** / **CLI** view, one writer at a time |
| **Output** | Text | Text | Rich chat | Rich chat, **Mermaid diagrams, Excalidraw whiteboard**, file panel with the changed lines |
| **Prompts (permissions, questions, plans)** | Yes | Yes (it's a terminal) | Yes | Yes, same choices as the terminal (keys 1–3, Esc, Shift+Tab modes) |
| **History of closed sessions** | `claude --resume` picker | No | Its own sessions | **15 days by day**, with resume in Vlens or the terminal |
| **Limits and context health** | `/usage`, `/context` | Status line | Settings | Home and sidebar: limits, heavy sessions with Compact / Fresh start |
| **Team tools** | `gh` by hand | No | PR status for its own sessions | **PR Review** (all your PRs, Claude reviews and follow-ups) and a skills **Marketplace** |
| **Skills, hooks, MCP** | Edit JSON files | No | Partly | One Settings page, writes the same files the CLI reads |

**Vlens and vTower work together.** vTower is where you type in terminals; Vlens is where you see every session at once, read the diagrams and review the plan. A session you open in a vTower tab shows up in Vlens's sidebar live (before its first message, too), Vlens's notifications cover it when it goes from working to waiting, and the Hooks page marks the hooks vTower installed so you don't edit them by accident. If you want to keep typing in Vlens instead, **Take over here** ends the terminal process and continues the same conversation.

**Why not just the desktop app?** Use it if all your work starts there. Vlens is for when your sessions are spread across terminals, vTower and the app: it reads them all from `~/.claude`, so nothing has to start in Vlens to show up in Vlens.

## Features in detail

### Sessions

- **Home**: what Vlens opens to (the Home button at the top of the sidebar, or ⇧⌘H). A greeting and a message box: pick a folder, permission mode and model, and start a session. Under it: **Needs you**, **Running now** and **Recent** sessions, sessions that are past half full with **Compact** / **Fresh start**, and a strip of today's numbers (5-hour and weekly limits, messages and tokens read today, sessions running and used this week).
- **Context health**: every reply re-sends the whole session, so long sessions burn your limits fastest. **Compact** runs `/compact`. **Fresh start** has Claude write a handoff note, then starts a new session in the same folder from it. Both are off for sessions open in a terminal or the desktop app. Compactions show in a session as a "Conversation compacted" divider you can expand.
- **Sidebar**: three lists.
  - **Pinned**: sessions you pinned.
  - **Sessions**: ones open in a running Claude Code process (terminal or desktop app), the one you have open, and ones Vlens started or replied in lately. Grouped by folder, or as one list (the button next to the heading). Forks show under the session they came from.
  - **Archived**: sessions you put away.
  
  A solid green dot means it's working, a hollow dot means it's waiting for you, amber means it needs you. The list refreshes every 5 seconds. Hide the sidebar with ⌘B.
- **Session menu** (`⋯` on each item):

  | Item | What it does |
  | --- | --- |
  | **Rename** | Same as `/rename`, so the CLI sees it. |
  | **Fork** / **Fork in Terminal** | A copy with its whole history in the same folder (`claude --resume … --fork-session`). The original stays as it is. Also ⇧⌘F. |
  | **Pin / Unpin** | Keep it at the top. |
  | **Archive / Unarchive** | Put it away in Archived (⌘⌫). Sending a message brings it back. Not for sessions open in a terminal or the desktop app. |
  | **Remove from Recent** | Drops a session Vlens used lately from the list. |
  | **Reload** | Restarts Claude on the same conversation, so it re-reads `CLAUDE.md`, settings, skills, hooks and MCP servers. Also `/reload`. |
  | **Continue in terminal** | Opens `claude --resume` in Terminal or iTerm. |
  | **End session** | Stops the Claude process. Works for terminal sessions, and for desktop-app sessions while Claude isn't working on them. |
  | **Delete** | Only once it's stopped. Files move to Vlens's `trash/` folder, so you can move them back to `~/.claude/projects/<project>/`. |
- **New session**: click **New session** (⌘N), pick a folder (a recent one, browse, or type a path like `~/Desktop/app`), and type the first message. It starts a real `claude` session there.
- **Worktrees**: turn on **New worktree** before you start a session (or File → New Session in Worktree, ⇧⌘N). The session gets its own copy of the repo at `<repo>/.claude/worktrees/<name>` on a branch `worktree-<name>`, so two sessions on one repo never edit the same files. Needs a git repo with at least one commit. Remembered per folder.
- **Quick switcher**: ⌘K from anywhere. Find a session, a PR or an app action. ↩ opens it, ⌘↩ starts a new session in that folder, ⌥↩ opens the session in Terminal.
- **Inspector**: a panel beside the chat (button in the chat header, or ⌥⌘I) with how full the context is (and Compact), the files the session changed, your plan usage, and its terminal.
- **Usage**: the bottom of the sidebar shows your plan's **5-hour** and **weekly** limits (how much is used and when each resets). Each session shows how full its context window is. Limits update whenever Vlens runs Claude; the refresh button sends one tiny Haiku request (about $0.0004).
- **History**: lists sessions you closed in the last 15 days, by day, with search (⌘Y). **Resume here** opens one in Vlens, **Terminal** continues it with `claude --resume`, and the pin keeps it in the sidebar.

### Chat

- **Chat view**: renders a session like a chat (markdown, thinking, tool calls with their output). A session that's still running in the terminal updates live.
- **CLI view**: the **CLI** switch in the chat header runs the real `claude --resume` for this session inside Vlens. **Chat** switches back (that ends the claude in the CLI view; the conversation is kept).
- **One writer at a time**: a running `claude` keeps the conversation in memory, so Vlens can't type into it. While a session is open in a terminal or the desktop app, Vlens shows it live but swaps the message box for a banner. Type there, or click **Take over here**: Vlens asks first, then ends the terminal's claude (or the desktop app lets go of it) and you continue in Vlens. Going the other way, **Continue in terminal** opens `claude --resume` in Terminal or iTerm.
- **Claude's questions**: when Claude asks you something (its multiple-choice question tool), Vlens shows the options as a card: pick one or more, or type your own under Other, then **Send**. For a session open in a terminal, answer there.
- **Permission modes**: the picker under the message box has the CLI's five modes (Ask before edits, Accept edits, Plan mode, Auto mode, Bypass permissions) and starts in your terminal's default (`permissions.defaultMode` in `~/.claude/settings.json`). Shift+Tab cycles them.
- **Permission prompts** offer the terminal's choices: Yes, Yes and don't ask again (showing the rule it saves), and No with a note telling Claude what to do instead. Keys 1–3 pick, Esc stops.
- **Plan approval**: when Claude finishes a plan, Vlens shows it with Yes + auto mode / auto-accept edits / manually approve edits, or No, keep planning.
- **Type ahead**: send while Claude is working and the message waits above the box, then goes out when Claude is done. Stopping the reply pauses them.
- **Message box**: paste, drop or 📎 attach images (PNG, JPEG, GIF, WebP; large ones are scaled down). Long pastes show as a card. Type `/` for slash commands and skills for that folder. Pick a model per message.
- **File panel**: when Claude writes or edits a file, the reply shows a chip like `step1_basics.py +59 −0`; click it (or any file path in a reply) to open the file beside the chat, scrolled to the changed lines. Markdown has Preview / Code, images preview, folders list their files. Buttons: reload, copy path, open in VS Code at that line, reveal in Finder, full width. Only files in your home folder open, never folders like `~/.ssh` or `~/.aws`, and a symlink can't point around that.
- **Terminal**: a real shell in the session's folder beside the chat (**Terminal** button or Ctrl+`). It keeps running while hidden. Shells no window has used for 30 minutes are closed.
- **Sub-agents**: select any text in an answer to comment or ask about it. A panel slides in and runs a real `claude -p` in that session's folder, focused on the snippet. Sub-agents run read-only and are one level deep. The bottom of each panel shows the commands it ran.
- **Background tasks**: Vlens shows what Claude and its background agents are doing. Stop one task without stopping the rest.
- **Desktop notifications**: when Claude asks permission, asks a question, has a plan ready or finishes, and you're in another window. Terminal and desktop-app sessions notify when they go from working to waiting. Click one to open that session. Turn it off in Settings → Notifications.
- **Menu bar icon** (Mac app): shows your 5-hour and weekly use, sessions waiting for you, and what's working. For a permission request it shows the tool and a short summary of the request, with **Allow**, **Always Allow** (when offered), **Deny** or **Open in Vlens**. Also New Session, Quick Switcher and Quit.

### Keyboard shortcuts (Mac app menus)

| Shortcut | Action |
| --- | --- |
| ⌘N / ⇧⌘N | New session / new session in a worktree |
| ⌘O | Open folder |
| ⌘⌫ | Archive session |
| ⌘. | Stop Claude |
| ⌥⌘K | Compact context |
| ⇧⌘F | Fork session |
| ⌥⌘T / ⌥⌘H | Continue in terminal / Take over here |
| ⌘1 / ⌘2 | Sessions / PR Review |
| ⇧⌘H, ⌘Y | Home, History |
| ⌘K | Quick switcher |
| ⌘] | Next session that needs you |
| ⌘B | Hide or show the sidebar (also ⌃⌘S) |
| ⌥⌘I | Inspector |
| Ctrl+` | Terminal |

## Flow diagrams (built in)

Replies that contain a ```` ```mermaid ```` block are drawn as diagrams (flowcharts, sequence, state, ER, timeline…), in light or dark to match your system, with **code / copy / full screen** buttons. Arrows marked `animate: true` in the diagram move; Settings can animate every arrow.

Vlens also ships its own Claude Code plugin in [`lens-plugin/`](../lens-plugin) with a **`lens:diagrams`** skill that tells Claude when and how to draw a diagram. Vlens passes it with `--plugin-dir` only to the runs it starts, so your terminal `claude` doesn't get it. Settings → **Diagrams & whiteboard** turns drawing, animate-every-arrow and the skill on or off separately. More built-in skills can go in the same plugin.

## Whiteboard (built in)

**Mermaid or whiteboard?** Mermaid is for flowcharts and structured diagrams (flows, sequences, states, schemas, timelines): the default for any flow. The Excalidraw whiteboard is for teaching: when you ask Claude to teach or walk you through something and notes, groupings or comparisons matter more than exact shapes. The two built-in skills tell Claude which to use, and not to draw the same thing twice.

Replies with an ```` ```excalidraw ```` block (a JSON list of simple shapes, labels and arrows) are drawn as hand-drawn [Excalidraw](https://excalidraw.com) boards. **Open board** makes it a full editable whiteboard: move things, draw, add notes, export PNG or `.excalidraw`. Every Mermaid diagram also gets an **Open on whiteboard** button that converts it into editable shapes.

The built-in **`lens:whiteboard`** skill (in `lens-plugin/`) tells Claude to teach with a board when boxes, arrows and notes explain it better. Settings → **Diagrams & whiteboard** switches drawing and each skill on or off separately. (Vlens builds a small `lens` plugin with only the skills that are on, in its data folder, and passes it with `--plugin-dir`.) Excalidraw's fonts ship with Vlens in `public/excalidraw-assets/`, so boards work offline.

## PR Review

Click **PR Review** in the sidebar (⌘2). It reads GitHub through the `gh` CLI, so it uses the account `gh` is signed in with. The list reloads every 10 minutes; the ↻ button gets the latest now.

**Lists** (left panel):

| List | What's in it |
| --- | --- |
| **New** | What changed on your PRs and reviews since you last looked. |
| **My PRs** | PRs you opened: Your move, Ready to merge, Awaiting review, Drafts, Stale (30+ days). |
| **Needs my review** | Needs you, Needs your team, Approved · awaiting others, Waiting on author, Done · your part, FYI. Recent PRs from your teammates show under Needs your team. |

Inside each list, PRs are nested by **author**, then **repo** (My PRs only by repo: they're all yours). Click an author to fold their PRs. Nothing is hidden: every open PR shows until it's merged or closed.

Each card shows a risk badge and where its review stands: **Draft ready**, **Posted**, **New commits** (the author pushed since your review), **Reviewing…** or **Auto review ready**. A Claude mark means a review you started, a bot means one Claude did by itself (auto re-review).

**The PR page** has four tabs:

| Tab | What's on it |
| --- | --- |
| **Summary** | The description, and Claude's take: findings, risk, earlier comments fixed, and **Ready to approve** when a follow-up review finds nothing left. |
| **Discussion** | Claude's draft comments and the PR's review threads, by file and line. |
| **Files changed** | The changed files. |
| **Checks** | CI checks and merge conflicts. |

The rail on the right (wide windows) shows the **Review lifecycle** card (last review, last post, the PR's commit now, and the **Auto re-review new commits** switch), the **risk** score, details, **Reviewers**, and this PR's sessions.

**Actions** at the top:

| Button | What it does |
| --- | --- |
| **Open on GitHub** | Opens the PR in your browser. |
| **Refresh** | Gets the latest from GitHub. |
| **Review with Claude** | Starts a Vlens session that reviews the PR, at Quick, Standard or Deep depth. It runs in your local clone, or reads the PR with `gh` from your home folder if you don't have one. It posts nothing. The findings show in a results panel, where you keep, edit and post them (see below). |
| **Follow-up review** | Takes the place of Review with Claude once the PR has a review at an older commit. See **The review lifecycle** below. |
| **Address feedback** | Your own PRs, needs a local clone. It switches your clone to the PR's branch (it asks first), then a session reads the review comments and failing checks and makes the fixes. Claude is told not to push or reply on GitHub without asking you. |
| **Before/after** | Only for `vendasta/galaxy`, with a local clone. Uses galaxy's own `galaxy-before-after` skill to take before and after screenshots of what the PR changes. |
| **Merge** | Your own PRs, once they're approved, CI isn't failing and there are no conflicts. Pick squash, merge commit or rebase, then confirm. |

Local clones are found from the folders your sessions run in (and one level inside them, e.g. `~/code/<repo>`).

**The review skill.** If the Vendasta dev-agent toolkit is installed (its marketplace clone at `~/.claude/plugins/marketplaces/vendasta-dev-agent-toolkit`) and **Settings → Diagrams & whiteboard → PR review skill (lens:review)** is on, Review with Claude uses the toolkit's `lens:review` skill. Otherwise Claude reviews with `gh pr diff` and the code in your clone.

**Drafts and posting.** On the Discussion tab, each of Claude's drafts has **Post**, **Edit** and **Discard**; **Post N as one review** sends them all at once. Review threads have reply, **Resolve** / **Unresolve** and **Ask Claude**, and there's a box to leave a comment on the PR. Everything posts from your GitHub account. If the PR has new commits since the review, Vlens asks again (**Post anyway** pins the comments to the commit the review read).

### Risk score

Every PR gets a score from 0 to 100, with the reasons listed. It's worked out from the files, not by AI, so it's free and instant.

- Points for: many changed lines or files, your sensitive paths, secrets or credentials, schema or migrations, auth / billing / permissions code, CI or deploy config, dependency changes, code changed without tests, mostly deletions.
- Points off: only tests or docs.
- Low is under 30, medium 30–59, high 60 and up.
- When Claude reviews the PR it can move the score by up to 20, and says why.

### What Vlens can do on GitHub as you

> Everything below uses your own `gh` login, and only when you click. **Vlens never posts or approves on its own**: Review with Claude and auto re-reviews post nothing.
>
> | Action | Where | When it asks first |
> | --- | --- | --- |
> | Post a review (Comment or Request changes) | Results panel **Post review as me**; Discussion tab **Post** / **Post N as one review** | Always: a confirm names the PR and your account. Asks again if the PR has new commits. |
> | Reply to a thread, resolve or unresolve it, comment on the PR | Discussion tab | Only when you click. The text is what you typed. |
> | Merge | **Merge** on your own PR | A confirm bar with the merge method. |
> | Approve | Discussion tab **Approve** (not on your own PRs) | Always: a confirm names the PR and your account. |
>
> **Address feedback** and **Before/after** are normal Claude sessions in your clone: they follow your permission prompts, and Claude is told not to push or post without asking you.

## The review lifecycle

A PR goes round a loop: you review it with Claude, you post, the author pushes fixes, you check again, until it's approved and merged. Vlens tracks where each PR is in that loop.

```
 Needs my review ──► Review with Claude ──► you post ──► Waiting on author
        ▲                                                     │
        └──── Needs you · "new commits since your review" ◄───┘
                (auto re-review on: the follow-up drafts are already waiting)
```

**New commits.** When the author pushes after your review (Comment or Request changes), the PR moves back to **Needs you**, saying "new commits since your review at abc1234".

**Follow-up review.** Once a PR has a Claude review at an older commit, the button becomes **Follow-up review**. A second full review always finds something new (one more nit, one more question), so review → fix → review never ends. A follow-up converges instead:

1. It checks each earlier ask (Claude's last findings and the PR's earlier inline comments): fixed, unfixed or unverified.
2. It reads only what the new commits changed (`gh api …/compare/<reviewed>...<now>`); after a force-push it falls back to the whole diff.
3. New findings only on lines the new commits touched, and only blockers or shoulds. A blocker may be raised anywhere.
4. It says **Ready to approve** when every earlier blocker and should is fixed and nothing new blocks the merge.

**Auto re-review new commits** (a switch on each PR's Review lifecycle card, off by default). When the author pushes, Claude does the follow-up review by itself and leaves the findings as drafts on the Discussion tab, marked with a bot. It never posts. If the PR was never reviewed, the first new commit gets a full review.

- There's no timer and no background schedule: it runs when Vlens reads your PR list (every 10 minutes while Vlens is open, or ↻). So it only runs while Vlens is open.
- At most two run at once. The PR's card shows the steps and **Stop**; a failed one shows **Retry**. A stopped or failed review isn't started again at that commit until you retry or the author pushes again.
- If the PR was only rebased (same changes), the last review still stands.
- A desktop alert says when the drafts are ready, or when it failed.

**Safety of auto re-reviews:** before Claude starts, Vlens saves the PR, its diffs, earlier comments and the last review's findings to a folder. Claude can then only **Read, Grep and Glob**: no shell, no MCP, no network, no `.env`, `.pem` or `.key` files. It can't post, push or run anything. A review stops after 20 minutes. Only one Vlens on a Mac reviews a given PR at a time (the app and a dev server share the data folder).

## Marketplace

**Marketplace** (sidebar, above Settings) browses Claude Code plugins from every marketplace you've added, plus Anthropic's built-in catalogs. Search, filter by marketplace or installed / not installed, and open a plugin to see the skills inside (read from its `SKILL.md` files), everything it contains, its README, and **how many tokens it adds to every session** before you install it.

- **Add marketplace** takes a GitHub repo (`owner/repo`), a git/https URL or a folder with `.claude-plugin/marketplace.json`; for example your team's internal skills repo. Vlens has no marketplaces built in; it uses `claude plugin marketplace add`, so the terminal sees the same list.
- **Install** for all your projects, or for one project (shared with the team, or only you). Plugins that ship switched off are turned on after a Vlens install. Each install has an on/off switch, Uninstall and Update.
- Your own marketplaces rank above the big built-in catalogs. Plugins run code (hooks, MCP servers): install only from sources you trust.

## Settings

Open **Settings** at the bottom of the sidebar.

- **Appearance**: System (follows your Mac), Light or Dark, and an accent colour. Saved in this browser and applied before the page paints, so there's no flash. Diagrams follow it too.
- **Terminal profile** (in Appearance): colours, font, size, line height and cursor for the Terminal panel and the CLI view. Built-in schemes (Vlens, Dracula, Nord, One Dark, Tokyo Night, Catppuccin Mocha, Gruvbox Dark, Solarized, GitHub Light), macOS Terminal's own profiles, or **Customize a copy** of any of them. Open terminals change right away.

- **Account**: who the CLI is signed in as (email, org, plan). **Switch account** runs `claude auth login` in a new terminal window; **Sign out** runs `claude auth logout`.
- **AI agent**: the coding agent Vlens runs sessions with (Claude Code today).
- **Model**: the default model for replies, new sessions and sub-agents started from Vlens. You can also pick a model per message next to the message box. Your terminal `claude` is not changed. In read-only (plan) mode the CLI uses at least Sonnet.
- **Auto-restore**: when a terminal session stops without closing normally (crash, closed window, reboot), Claude Code leaves its `~/.claude/sessions/<pid>.json` behind. Vlens spots that and shows it in the sidebar with **Restore**, which reopens it with `claude --resume` in Terminal or iTerm. Turn on **Reopen automatically** to skip the click. This only works while Vlens is running.
- **Skills**: your skills (`~/.claude/skills`) and, if you pick a project, that project's skills (`.claude/skills`). You can create, edit `SKILL.md`, turn on/off (off moves it into a `.disabled` folder the CLI doesn't load) and delete (moves it into `.trash`). Skills synced from claude.ai and plugin skills are view-only. Changes apply to new and resumed sessions.
- **Hooks**: every hook from `~/.claude/settings.json` and, if you pick a project, its `.claude/settings.json` and `.claude/settings.local.json`, grouped by event. Plugin hooks are view-only. You can add a hook (command, prompt, agent or URL; all 33 events the CLI knows), edit it as JSON, turn it off/on, delete it, or pause all hooks (the CLI's `disableAllHooks`). Hooks another app installed are marked (e.g. "added by my-tool" when its command ends in `# my-tool-hook`). Vlens changes only the `hooks` key, keeps the file's formatting, refuses to write if the file changed meanwhile, and saves a backup in `~/.claude/backups` first (last 5 kept). The CLI has no per-hook off switch, so "off" parks the hook in `hooks-off.json` in Vlens's data folder until you turn it back on.
- **MCP servers & connectors**: lists everything from `claude mcp list` with its status. You can add a server (HTTP, SSE or a local command, for all projects or one project folder), remove one, and sign in or out. claude.ai connectors are added and removed on claude.ai; here you can sign in to them. Connectors are grouped (connected, needs sign-in) with a search box.
- **Diagrams & whiteboard**: drawing and the built-in skills on or off, including the **PR review skill (lens:review)** used by Review with Claude.
- **Notifications**: desktop notifications on or off.
- **About & updates**: your version, and whether a new release is out.

**GitHub** shows whether the GitHub CLI (`gh`) is installed and which account it's signed in to, with **Install gh**, **Sign in to GitHub** or **Switch account**. Use it if you skipped GitHub on the Get started page.

The first time Vlens opens a terminal window, macOS asks whether it may control Terminal (or iTerm). Click OK. If you said no, allow it in System Settings → Privacy & Security → Automation.

## Building the dmg

```bash
npm run dist --prefix desktop
```

That builds `desktop/dist/Vlens-<version>-arm64.dmg`: it runs `next build`, stages the server in `desktop/app-server`, packs and ad-hoc signs the app. Open the dmg and drag **Vlens** into Applications to try it.

## Developing

- `npm run app` starts `next dev` on port 3467 and opens the Electron window on it. Edits in `src/` reload right away; quitting the window stops the server.
- Only want the browser? `npm run dev -- -p 3467`, then open http://127.0.0.1:3467.
- To try things without touching your own pins and settings, use a scratch data folder: `LENS_DATA_DIR=/tmp/vlens-data npm run app`.
- `lens-plugin/` holds the built-in skills (diagrams, whiteboard) that Vlens loads only into the runs it starts. Your terminal `claude` doesn't get them.
- Before a PR: `npx tsc --noEmit` and `npx eslint src` should both be clean.

## Releasing a new version

1. Bump [`VERSION`](../VERSION) (`1.1.0` → `1.1.1` for fixes, `1.2.0` for features, `2.0.0` for big changes).
2. Add a `## <version> — <date>` section at the top of [CHANGELOG.md](../CHANGELOG.md) with what changed.
3. Run `npm run release -- --dry`: it syncs the version into both `package.json` files and shows the notes. Commit and push.
4. Run `npm run release`: it builds the dmg, tags `v<version>`, and publishes a GitHub release with the dmg attached. `gh` has to be signed in to an account that can publish to this repo (or set `GH_TOKEN`).

## Mac app

Vlens is a Mac app (`Vlens.app`) that starts its own server, so you don't need a terminal.

**Get started**: the first time Vlens opens (or whenever Claude Code is missing or signed out) it shows a setup page with three steps: install Claude Code, sign in to Claude, and optionally connect GitHub for PR Review. Each button runs the step in a Terminal window, and the page ticks it off once it's done.

The app is only ad-hoc signed (no Apple developer ID), so the first time, open it, click **Done** on the warning, then System Settings → Privacy & Security → **Open Anyway**.

- It runs the bundled server on `127.0.0.1:3459` (or the next free port) with Electron's own Node, so you don't need Node installed, only Claude Code (and `gh` for PR Review).
- **Optional, for Review with Claude:** the Vendasta dev-agent toolkit's marketplace (`claude plugin marketplace add` it, so it lands in `~/.claude/plugins/marketplaces/vendasta-dev-agent-toolkit`). With it, reviews use its `lens:review` skill; without it, Claude reviews with `gh` and your local code. Switch it in Settings → Diagrams & whiteboard.
- It reads your login shell's `PATH` at startup, so it finds `claude`, `gh` and `git` like your terminal does.
- **Vlens → Open at Login** starts it when you log in. **Show Server Log** opens `~/Library/Logs/Vlens/server.log`.
- Vlens's data (pins, settings, threads, review records and auto re-review switches, trash) lives in `~/Library/Application Support/Vlens/`, shared with the dev server. If you used Claude Lens before, its folder is copied here the first time Vlens starts (Claude Lens keeps its own).

## Updating

Vlens checks GitHub for a new release a few times a day. When one is out, a card offers:

- **Download**: opens the new dmg.
- **Later**: hides the card for a day.
- **Skip this version**: never shows this version again.

To install it:

1. Quit Vlens (⌘Q).
2. Open the download and drag **Vlens** to Applications, replacing the old one.
3. If macOS blocks it: System Settings → Privacy & Security → **Open Anyway**.

Your sessions, pins and settings stay; they live outside the app.

## Security

- The local server only listens on `127.0.0.1` (this Mac), in the app and in `npm run dev`.
- It refuses API requests from other websites, and any request whose host isn't this Mac. A page in your browser can't use it to run Claude or a shell.
- The terminal socket needs a secret token per shell.
- The file panel opens only files in your home folder, never folders like `~/.ssh` or `~/.aws`, and follows symlinks before it checks.
- Image previews (SVG too) open sandboxed, so a file can't run script as Vlens.
- On GitHub, Vlens only does what's listed in [What Vlens can do on GitHub as you](#what-vlens-can-do-on-github-as-you).

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
| Home and stats | `src/components/HomeView.tsx`, `src/lib/stats.ts` |
| Compact / fresh start | `src/lib/context.ts` |
| Permission prompts | `src/lib/permissions.ts`, `src/components/PermissionCard.tsx` |
| Mermaid diagrams | `src/components/Mermaid.tsx` |
| Whiteboard (Excalidraw) | `src/components/Whiteboard.tsx` |
| Built-in skills (plugin) | `lens-plugin/`, `src/lib/lensPlugin.ts` |
| Mac app (Electron) | `desktop/main.cjs`, `desktop/scripts/prepare-server.mjs` |
| Where Vlens keeps its data | `src/lib/paths.ts` (`~/Library/Application Support/Vlens`, or `LENS_DATA_DIR`) |
| PR Review (GitHub via `gh`) | `src/lib/github.ts`, `src/components/PrInbox.tsx`, `PrPage.tsx`, `ReviewView.tsx` |
| Posting a review, merge, thread actions | `src/lib/postReview.ts`, `src/app/api/review/{post,merge,thread}` |
| Risk score | `src/lib/risk.ts` |
| Review lifecycle and auto re-review | `src/lib/lifecycle.ts`, `reviewWatch.ts`, `reviewWatchRunner.ts`, `reviewRecords.ts`, `src/components/PrLifecycle.tsx` |
| Worktrees, forks, archive | `src/lib/worktree.ts`, `fork.ts`, `archive.ts` |
| Terminal panel and CLI view | `src/lib/terminals.ts`, `src/components/TerminalPanel.tsx` |
| Terminal profiles | `src/lib/termProfiles.ts`, `termThemes.ts` |
| Blocks requests from other sites | `src/middleware.ts` |
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
