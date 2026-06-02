import { getULinkClient } from "@/lib/integrations/ulink/client";
import type { AgentEvent } from "./events";
import type { AgentMessage } from "./message";
import { applyEvent, emptyMessage, hydrateMessage } from "./message";
import type { ConversationSummary } from "./types";

function db() {
  return getULinkClient().schema("pm_agent");
}

export function deriveTitle(question: string): string {
  const firstLine = question.trim().split("\n")[0].trim();
  if (!firstLine) return "New chat";
  return firstLine.length > 60 ? firstLine.slice(0, 59).trimEnd() + "…" : firstLine;
}

export interface ConversationStore {
  createConversation(input: {
    title: string;
    userEmail: string | null;
  }): Promise<{ id: string }>;
  appendMessage(input: {
    conversationId: string;
    question: string;
    payload: AgentMessage;
    userEmail: string | null;
  }): Promise<void>;
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(
    id: string
  ): Promise<{ conversation: ConversationSummary; messages: AgentMessage[] }>;
  deleteConversation(id: string): Promise<void>;
}

function toSummary(r: Record<string, unknown>): ConversationSummary {
  return {
    id: r.id as string,
    title: r.title as string,
    createdByEmail: (r.created_by_email as string | null) ?? null,
    updatedAt: r.updated_at as string,
  };
}

export const conversationStore: ConversationStore = {
  async createConversation({ title, userEmail }) {
    const { data, error } = await db()
      .from("conversations")
      .insert({ title, created_by_email: userEmail })
      .select("id")
      .single();
    if (error) throw new Error(`createConversation: ${error.message}`);
    return { id: data!.id as string };
  },

  async appendMessage({ conversationId, question, payload, userEmail }) {
    const { error } = await db().from("messages").insert({
      conversation_id: conversationId,
      question,
      payload,
      user_email: userEmail,
    });
    if (error) throw new Error(`appendMessage(insert): ${error.message}`);
    const { error: touchErr } = await db()
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    if (touchErr) throw new Error(`appendMessage(touch): ${touchErr.message}`);
  },

  async listConversations() {
    const { data, error } = await db()
      .from("conversations")
      .select("id, title, created_by_email, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(`listConversations: ${error.message}`);
    return (data ?? []).map(toSummary);
  },

  async getConversation(id) {
    const { data: conv, error: cErr } = await db()
      .from("conversations")
      .select("id, title, created_by_email, updated_at")
      .eq("id", id)
      .single();
    if (cErr) throw new Error(`getConversation(conversation): ${cErr.message}`);
    const { data: rows, error: mErr } = await db()
      .from("messages")
      .select("id, question, payload, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (mErr) throw new Error(`getConversation(messages): ${mErr.message}`);
    return {
      conversation: toSummary(conv as Record<string, unknown>),
      messages: (rows ?? []).map((r) =>
        hydrateMessage(r.id as string, r.question as string, r.payload)
      ),
    };
  },

  async deleteConversation(id) {
    const { error } = await db().from("conversations").delete().eq("id", id);
    if (error) throw new Error(`deleteConversation: ${error.message}`);
  },
};

export async function persistTurn(
  store: ConversationStore,
  input: {
    question: string;
    conversationId: string | null;
    userEmail: string | null;
    events: AgentEvent[];
  }
): Promise<{ conversationId: string; title: string }> {
  const payload = input.events.reduce(applyEvent, emptyMessage("", input.question));
  const title = deriveTitle(input.question);
  let conversationId = input.conversationId;
  if (!conversationId) {
    const created = await store.createConversation({ title, userEmail: input.userEmail });
    conversationId = created.id;
  }
  await store.appendMessage({
    conversationId,
    question: input.question,
    payload,
    userEmail: input.userEmail,
  });
  return { conversationId, title };
}
