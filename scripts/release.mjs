// Publishes the version in VERSION: syncs it into both package.json files,
// builds the dmg, tags vX.Y.Z and creates a GitHub release with the dmg and
// that version's CHANGELOG notes.
//
//   npm run release              build and publish
//   npm run release -- --dry     check everything, build nothing
//
// gh must be signed in to an account that can publish to this repo (GH_TOKEN
// works too, e.g. GH_TOKEN=$(gh auth token -u <account>) npm run release).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dry = process.argv.includes("--dry");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`VERSION should look like 1.2.3, not "${version}".`);
const tag = `v${version}`;

// This version's notes: its "## X.Y.Z" section of the changelog.
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const at = changelog.search(new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m"));
if (at < 0) fail(`CHANGELOG.md has no "## ${version}" section. Add what changed first.`);
const rest = changelog.slice(at).split("\n").slice(1).join("\n");
const notes = rest.slice(0, rest.search(/^## /m) >= 0 ? rest.search(/^## /m) : undefined).trim();

if (out("git", ["tag", "--list", tag])) fail(`${tag} is already tagged. Bump VERSION for a new release.`);

// Both package.json files carry the version: the dmg's name and the app's About box use it.
for (const file of ["package.json", "desktop/package.json"]) {
  const p = path.join(root, file);
  const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
  if (pkg.version !== version) {
    pkg.version = version;
    if (!dry) fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`${file}: version → ${version}`);
  }
}

const dirty = out("git", ["status", "--porcelain"]);
if (dirty && !dry) {
  console.log("\nCommit your changes (including VERSION, CHANGELOG.md and the package.json versions) before releasing:\n" + dirty);
  process.exit(1);
}

const dmg = path.join(root, "desktop", "dist", `Claude Lens-${version}-arm64.dmg`);
console.log(`\nReleasing ${tag}${dry ? " (dry run)" : ""}\n\n${notes}\n`);
if (dry) process.exit(0);

run("npm", ["run", "dist"], { cwd: path.join(root, "desktop") });
if (!fs.existsSync(dmg)) fail(`The build didn't produce ${dmg}.`);

const body = `${notes}

---

**Install:** download \`Claude-Lens-${version}-arm64.dmg\` below, open it and drag Claude Lens into Applications. Apple Silicon Macs (M1 and later).

The app isn't signed by Apple yet, so the first time, right-click Claude Lens in Applications and choose **Open**. On first launch, the Get started page helps you install Claude Code and sign in.`;

run("git", ["tag", "-a", tag, "-m", `Claude Lens ${version}`]);
run("git", ["push", "origin", tag]);
// GitHub would turn the spaces into dots; upload a copy with a clean name.
const asset = path.join(root, "desktop", "dist", `Claude-Lens-${version}-arm64.dmg`);
fs.copyFileSync(dmg, asset);
run("gh", ["release", "create", tag, asset, "--title", `Claude Lens ${version}`, "--notes", body, "--latest"]);
console.log(`\n✓ Published ${tag}`);
