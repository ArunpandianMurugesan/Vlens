// node-pty 1.1.0 ships its spawn-helper without the execute bit, and then every
// terminal fails with "posix_spawnp failed". Put the bit back after each install.
import fs from "node:fs";
import path from "node:path";

const dir = path.join(import.meta.dirname, "..", "node_modules", "node-pty", "prebuilds");
for (const arch of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  const helper = path.join(dir, arch, "spawn-helper");
  if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
}
