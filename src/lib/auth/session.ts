import type { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

// Returns the signed-in user's email, or null if the session cookie is absent/invalid.
export async function getSessionEmail(request: NextRequest): Promise<string | null> {
  const session = request.cookies.get("fw_session")?.value;
  if (!session) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(session, true);
    return decoded.email ?? null;
  } catch {
    return null;
  }
}
