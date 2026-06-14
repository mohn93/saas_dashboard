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

// One-shot retrieval scoped to the caller's email. Deletes the token so a
// confirmation can't be replayed. Returns null if missing/expired or if the
// requester is not the user who created it.
export async function takePending(
  token: string,
  requesterEmail: string | null
): Promise<PendingQuery | null> {
  const redis = getRedis();
  const p = await redis.get<PendingQuery>(key(token));
  if (!p) return null;
  if (p.userEmail !== requesterEmail) return null;
  await redis.del(key(token));
  return p;
}
