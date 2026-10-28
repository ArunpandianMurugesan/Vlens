// electron-builder always strips node_modules from extraResources, but the
// standalone Lens server needs its own. So copy the staged server into the app
// ourselves, after the app folder is built and before the .dmg is made.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

exports.default = async function afterPack(context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const dest = path.join(app, "Contents", "Resources", "server");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, "..", "app-server"), dest, { recursive: true, verbatimSymlinks: true });
  console.log(`  • copied Lens server into ${path.relative(process.cwd(), dest)}`);

  // We don't have an Apple Developer ID yet, so electron-builder skips signing.
  // That leaves Electron's stock signature, which no longer matches our files,
  // and macOS then calls a downloaded copy "damaged". An ad-hoc signature
  // (signed by "-", no identity) seals our real files, so the app opens after
  // the usual right-click > Open.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  console.log("  • ad-hoc signed the app");
};
