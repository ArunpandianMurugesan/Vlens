# Changelog

Every Vlens release (called Claude Lens up to 1.0.1), newest first. The version lives in [`VERSION`](VERSION); `npm run release` builds the dmg for it and publishes it on the [Releases page](https://github.com/ArunpandianMurugesan/Vlens/releases).

Versions follow [semantic versioning](https://semver.org): **major** for big changes in how Vlens works, **minor** for new features, **patch** for fixes.

## Unreleased

PR Review is now about each PR's **review lifecycle**. Autopilot is gone.

- **Autopilot removed**: no background reviewer, no workflows, rules, queue, labels or board. Nothing reviews PRs on a timer any more.
- **New commits bring a PR back**: when the author pushes after your review, it moves to **Needs you** with "new commits since your review at abc1234". Cards show where each review stands: Draft ready, Posted, New commits, Reviewing…, Follow-up ready.
- **Follow-up review**: once a PR has a review at an older commit, Review with Claude becomes Follow-up review. It checks the earlier findings and comments, reads only the new commits, raises only blockers and shoulds, and says **Ready to approve** when nothing is left. This stops the review → fix → review loop that kept finding new nits.
- **Auto re-review new commits**: a switch on each PR (off by default). When the author pushes, Claude does the follow-up review by itself, locked down to reading files, and leaves drafts on the Discussion tab. It never posts, and it only runs while Vlens is open.
- **Approve** from the Discussion tab (others' PRs, after a confirm).
- **No hidden PRs**: Hide and Hidden (n) are gone; every open PR shows.
- **Lists nested by author, then repo** in New, My PRs (repo only) and Needs my review.
- A PR's review carries on in its one Review session instead of opening a new tab each time.

## 1.2.0 — 2026-11-18

A big one: PR Review with Claude and an optional Autopilot, a new Home, and many session tools. Coach and Retro are gone.

**PR Review**
- The PR space is now called **PR Review** (⌘2). Three lists: **New** (what changed since you last looked), **My PRs** and **Needs my review**, grouped by whose move it is. Recent PRs from your teammates show up too.
- One page per PR with four tabs: **Summary**, **Discussion**, **Files changed** and **Checks**, and a rail with risk, reviewers and what Autopilot will do.
- **Risk score** from 0 to 100 for every PR, with the reasons. Claude can move it by up to 20 when it reviews.
- **Review with Claude** at Quick, Standard or Deep depth. It uses the dev-agent toolkit's `lens:review` skill when you have it, and checks whether earlier review comments were fixed. It posts nothing on its own.
- **Discussion actions**: post Claude's drafts (one or all as one review), edit or discard them, reply to threads, resolve or unresolve them, and comment on the PR. All from your own GitHub account, and Vlens never approves.
- **Merge** your own approved PRs (squash, merge commit or rebase).
- **Address feedback** and, for galaxy, **Before/after** screenshots.
- Hidden PRs can be brought back from **Hidden (n)**.

**Autopilot** (off by default)
- Reviews PRs in the background with Claude, one at a time, on your schedule and within a daily cap.
- **Workflows**: when (asked to review, team asked, your own PR, a label), how deep, and then what (draft only, for you only, or post comments itself). The defaults never post.
- Hands a PR to you when it's too big, too risky, or touches your sensitive paths. Pause it per PR, **Run now**, **Stop**, **Retry**.
- Optional state labels on GitHub, and desktop alerts.
- Claude can only read the saved PR files (Read, Grep, Glob): no shell, no network.

**Sessions**
- **Home** is a start screen: start a session in any folder, see what needs you and what's running, today's numbers, and heavy sessions with Compact / Fresh start.
- Sidebar with **Pinned**, **Sessions** (by folder or one list) and **Archived**. Hide it with ⌘B.
- **Fork** a session (in Vlens or in Terminal); forks show under their parent.
- **Archive** sessions (⌘⌫) and open them again later.
- Start a session in its own **git worktree**.
- **Reload** a session (menu or `/reload`) so Claude re-reads its settings, skills, hooks and MCP servers.
- **CLI view**: switch a session to the real `claude --resume` inside Vlens. **Take over** works for desktop-app sessions too, and the sidebar can end idle desktop-app sessions.
- **⌘K quick switcher** for sessions, PRs and actions.
- **Inspector** beside the chat: context, changed files, plan usage, terminal.
- Each session gets its own terminal beside the chat, over a fast connection.
- Comment or ask a sub-agent right at the text you select. Long pastes show as a card. `/` commands are interactive.
- See what Claude and its background agents are doing, and stop one task without stopping the rest.
- Vlens chats show up in the terminal's `claude --resume` list.

**Mac app**
- Real **File, Session, Go and View** menus with shortcuts.
- A **menu bar icon** that shows what needs you, with Allow / Always Allow / Deny for permission requests.
- Real Mac notifications when a session needs you.
- An update check: **Download**, **Later** or **Skip this version**.
- Settings as cards with a section list, accent colours, and an **AI agent** setting.

**Terminal profiles**
- Settings → Appearance → **Terminal profile** sets the colours, font, size, line height and cursor for the Terminal panel and the CLI view. Open terminals change right away.
- Built in: Vlens (matches the app, the default), Dracula, Nord, One Dark, Tokyo Night, Catppuccin Mocha, Gruvbox Dark, Solarized Dark and Light, and GitHub Light.
- macOS Terminal's own profiles too: Basic, Clear Dark, Clear Light, Grass, Homebrew, Man Page, Novel, Ocean, Pro, Red Sands, Silver Aerogel and Solid Colors.
- **Customize a copy** of any profile to make your own.

**Removed**
- Coach, Retro and lessons, and the 14-day activity chart on Home.

**Fixes and safety**
- Vlens's local server refuses requests from other websites, and only listens on this Mac (also when you run it with `npm run dev`).
- Image previews (SVG too) open sandboxed. The file panel follows symlinks before checking a file is allowed.
- The Mac app checks that requests really come from Vlens's own page.
- Safer data files: writes can't leave half a file, and a file that can't be read is kept aside instead of being overwritten.
- Autopilot posts nothing if you pause the PR, turn Autopilot off or change its workflow while a review runs. It never posts a review that looks like it contains a secret.
- Only one Vlens per Mac runs Autopilot at a time.
- A review that times out on the way to GitHub isn't posted twice.
- Vlens asks before posting a review, merging, or switching your clone to a PR's branch.
- Terminals nobody uses any more are closed. Quitting Vlens no longer leaves its server running.
- The release script can pick up where a failed release stopped.
- Better contrast in dark mode, visible focus rings, and layout fixes for narrow windows.

## 1.1.0 — 2026-10-28

**Claude Lens is now Vlens**
- New name in the app, the Dock, the dmg and the menus. New home: [ArunpandianMurugesan/Vlens](https://github.com/ArunpandianMurugesan/Vlens).
- Your pins, settings, trash and lessons carry over: the first time Vlens starts, it copies `~/Library/Application Support/Claude Lens` to `~/Library/Application Support/Vlens`. Claude Lens keeps its own copy, so both apps can stay installed. Logs are now in `~/Library/Logs/Vlens`.

## 1.0.1 — 2026-10-28

**Fixes**
- The app no longer shows as "damaged" on another Mac after downloading. The build now gives it an ad-hoc signature, so macOS can check the app's files.
- Install notes updated for newer macOS: the first time, open it from System Settings → Privacy & Security → **Open Anyway**.

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
