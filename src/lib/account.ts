import "server-only";
import { claudeCmd } from "./cli";
import type { Account } from "./types";

export async function getAccount(): Promise<Account> {
  const { out } = await claudeCmd(["auth", "status"]);
  try {
    const d = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    return {
      loggedIn: !!d.loggedIn,
      email: d.email ?? null,
      orgName: d.orgName ?? null,
      plan: d.subscriptionType ?? null,
      method: d.authMethod ?? null,
    };
  } catch {
    return { loggedIn: false, email: null, orgName: null, plan: null, method: null };
  }
}
