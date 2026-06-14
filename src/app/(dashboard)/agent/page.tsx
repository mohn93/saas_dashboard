"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { useConversationList } from "@/hooks/use-conversation-list";
import { AgentMessage } from "@/components/agent/agent-message";
import { ConversationSidebar } from "@/components/agent/conversation-sidebar";
import { Skeleton } from "@/components/ui/skeleton";

// Skeleton for the thread while a saved conversation is being fetched — mirrors
// the AgentMessage shape (question bubble → narration lines → result block) so
// the layout doesn't jump when the real messages arrive.
function ThreadSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="h-9 w-2/3 rounded-lg" />
          <div className="flex gap-2">
            <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          </div>
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export default function AgentPage() {
  const list = useConversationList();
  const onConversation = useCallback(() => {
    void list.refresh();
  }, [list.refresh]);
  const { messages, conversationId, busy, loadingThread, ask, sendFeedback, confirm, load, newChat } =
    useAgentStream(onConversation);
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const prevLenRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the composer from one line up to ~8 lines, then scroll internally,
  // so a long question is readable instead of cropped to a single line.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [input]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const newMessage = messages.length > prevLenRef.current;
    prevLenRef.current = messages.length;
    if (newMessage) stickRef.current = true;
    if (newMessage || stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return; // one stream at a time — ignore submits while streaming
    setInput("");
    void ask(q);
  }

  function handleDelete(id: string) {
    void list.remove(id);
    if (id === conversationId) newChat();
  }

  return (
    <div className="flex h-full gap-4">
      <ConversationSidebar
        conversations={list.conversations}
        activeId={conversationId}
        loading={list.loading}
        onNew={newChat}
        onSelect={(id) => void load(id)}
        onDelete={handleDelete}
      />

      {/* full-width column so the scroll area spans the gutters; content is
          centered by inner max-w-3xl wrappers. This lets the thread scroll when
          the cursor is anywhere in the column, not only over the narrow center. */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-3xl">
          <h1 className="text-2xl font-bold tracking-tight">PM Data Agent</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask about ULink in plain English — it explains the answer and shows the data. Read-only.
          </p>
        </div>

        <div ref={scrollRef} onScroll={onScroll} className="mt-6 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-6 pb-4">
            {loadingThread ? (
              <ThreadSkeleton />
            ) : (
              <>
                {messages.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    e.g. &ldquo;How many signups per week over the last 8 weeks?&rdquo;
                  </p>
                )}
                {messages.map((m) => (
                  <AgentMessage key={m.id} message={m} onFeedback={sendFeedback} onConfirm={confirm} busy={busy} />
                ))}
              </>
            )}
          </div>
        </div>

        <form onSubmit={submit} className="mx-auto mt-auto flex w-full max-w-3xl items-end gap-2 border-t border-border/50 pt-4">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline for multi-line questions.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e);
              }
            }}
            rows={1}
            aria-label="Ask a question about ULink data"
            placeholder="Ask a question about ULink data…"
            className="max-h-48 flex-1 resize-none rounded-lg border border-border/50 bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> Ask
          </button>
        </form>
      </div>
    </div>
  );
}
