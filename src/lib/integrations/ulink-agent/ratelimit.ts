import { getRedis } from "@/lib/cache/kv";

// "60s" | "30m" | "1h" → seconds. Defaults to 1 hour on anything unparseable.
export function parseWindow(spec: string): number {
  const m = /^(\d+)\s*([smh])$/.exec(spec.trim());
  if (!m) return 3600;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "s") return n;
  if (unit === "m") return n * 60;
  return n * 3600;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  limit: number;
}

// Fixed-window counter keyed per user. Cheap (one INCR + conditional EXPIRE) and
// dependency-free on top of @upstash/redis. Fails open if Redis is unreachable.
export async function checkAgentRateLimit(email: string): Promise<RateLimitResult> {
  const limit = Number(process.env.ULINK_AGENT_RATE_LIMIT || 30);
  const windowSec = parseWindow(process.env.ULINK_AGENT_RATE_WINDOW || "1h");
  const bucket = Math.floor(Date.now() / 1000 / windowSec);
  const key = `agent:rl:${email}:${bucket}`;
  try {
    const redis = getRedis();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSec);
    return { ok: count <= limit, remaining: Math.max(0, limit - count), limit };
  } catch {
    return { ok: true, remaining: limit, limit };
  }
}
