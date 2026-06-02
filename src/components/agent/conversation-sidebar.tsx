"use client";

import { formatDistanceToNow } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/integrations/ulink-agent/types";

export function ConversationSidebar({
  conversations,
  activeId,
  onNew,
  onSelect,
  onDelete,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border/50 pr-3">
      <button
        type="button"
        onClick={onNew}
        className="mb-3 flex items-center gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm font-medium hover:bg-accent"
      >
        <Plus className="h-4 w-4" /> New chat
      </button>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="px-2 py-1 text-xs text-muted-foreground">No saved chats yet.</p>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent",
              c.id === activeId && "bg-accent"
            )}
            onClick={() => onSelect(c.id)}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate">{c.title}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}
                {c.createdByEmail ? ` · ${c.createdByEmail}` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              aria-label="Delete chat"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
