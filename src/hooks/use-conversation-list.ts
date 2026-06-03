"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationSummary } from "@/lib/integrations/ulink-agent/types";

export function useConversationList() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // Start true so the sidebar shows skeleton rows on first paint rather than
  // flashing "No saved chats yet." before the initial fetch resolves.
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/conversations");
      if (!res.ok) return;
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setConversations(data.conversations ?? []);
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    // Optimistic removal.
    setConversations((prev) => prev.filter((c) => c.id !== id));
    try {
      const res = await fetch(`/api/agent/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) void refresh(); // server rejected — restore the row
    } catch {
      // delete failed — re-sync from the server so the row reappears
      void refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { conversations, loading, refresh, remove };
}
