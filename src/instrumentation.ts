// Runs once when the Vlens server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Bots whose automation is on check their bot.yaml triggers while Vlens runs.
  const { startBots } = await import("./lib/botEngine");
  startBots();
  // Bots whose watch is on check it at their own pace (lib/botWatch.ts).
  const { startWatches } = await import("./lib/botWatch");
  startWatches();
}
