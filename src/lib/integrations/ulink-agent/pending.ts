import { randomUUID } from "crypto";
import { getRedis } from "@/lib/cache/kv";
import type { ChartSpec, DisplayMode } from "./types";

const TTL_SECONDS = 5 * 60; // a confirmation prompt is short-lived

export interface PendingQuery {
  rawSql: string; // the model's SQL, for display + logging
  wrappedSql: string; // the validated, executable (LIMIT-wrapped) SQL
  chart: ChartSpec;
  question: string;
  display: DisplayMode;
  estCost: number;
  estRows: number;
  userEmail: string | null;
  conversationId: string | null;
}

function key(token: string): string {
  return `agent:pending:${token}`;
}

export async function stashPending(p: PendingQuery): Promise<string> {
  const token = randomUUID();
  await getRedis().set(key(token), p, { ex: TTL_SECONDS });
  return token;
}

// One-shot, replay-proof retrieval. GETDEL makes the read+delete atomic, so two
// concurrent confirmations of the same token can't both execute the query. Note:
// a token whose stored email doesn't match the requester is still consumed (the
// atomic delete happens first) — acceptable, since a mismatch means a bug or an
// attempt to redeem someone else's token, never a normal flow.
export async function takePending(
  token: string,
  requesterEmail: string | null
): Promise<PendingQuery | null> {
  const p = await getRedis().getdel<PendingQuery>(key(token));
  if (!p) return null;
  if (p.userEmail !== requesterEmail) return null;
  return p;
}
