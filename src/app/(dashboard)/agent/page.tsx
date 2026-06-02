"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useAgentStream } from "@/hooks/use-agent-stream";
import { useConversationList } from "@/hooks/use-conversation-list";
import { AgentMessage } from "@/components/agent/agent-message";
import { ConversationSidebar } from "@/components/agent/conversation-sidebar";

export default function AgentPage() {
  const list = useConversationList();
  const onConversation = useCallback(() => {
    void list.refresh();
  }, [list.refresh]);
  const { messages, conversationId, ask, sendFeedback, load, newChat } =
    useAgentStream(onConversation);
  const [input, setInput] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const prevLenRef = useRef(0);

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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
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
        onNew={newChat}
        onSelect={(id) => void load(id)}
        onDelete={handleDelete}
      />

      <div className="mx-auto flex h-full max-w-3xl flex-1 flex-col">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">PM Data Agent</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask about ULink in plain English — it explains the answer and shows the data. Read-only.
          </p>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="mt-6 flex-1 space-y-6 overflow-y-auto pb-4"
        >
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              e.g. &ldquo;How many signups per week over the last 8 weeks?&rdquo;
            </p>
          )}
          {messages.map((m) => (
            <AgentMessage key={m.id} message={m} onFeedback={sendFeedback} />
          ))}
        </div>

        <form onSubmit={submit} className="mt-auto flex gap-2 border-t border-border/50 pt-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about ULink data…"
            className="flex-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
          <button
            type="submit"
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          >
            <Send className="h-4 w-4" /> Ask
          </button>
        </form>
      </div>
    </div>
  );
}
