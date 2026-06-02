"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationSummary } from "@/lib/integrations/ulink-agent/types";

export function useConversationList() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/conversations");
      if (!res.ok) return;
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setConversations(data.conversations ?? []);
    } catch {
      /* best-effort */
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    // Optimistic removal.
    setConversations((prev) => prev.filter((c) => c.id !== id));
    try {
      await fetch(`/api/agent/conversations/${id}`, { method: "DELETE" });
    } catch {
      /* best-effort; refresh will reconcile on next mount */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { conversations, refresh, remove };
}
