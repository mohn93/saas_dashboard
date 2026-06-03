import { getULinkClient } from "@/lib/integrations/ulink/client";
import { NotFoundError } from "./errors";
import type { AgentEvent } from "./events";
import type { AgentMessage } from "./message";
import { applyEvent, emptyMessage, hydrateMessage } from "./message";
import type { ConversationSummary } from "./types";

function db() {
  return getULinkClient().schema("pm_agent");
}

// Throws NotFoundError unless `userEmail` owns conversation `id`.
async function assertConversationOwner(id: string, userEmail: string): Promise<void> {
  const { data, error } = await db()
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("created_by_email", userEmail)
    .maybeSingle();
  if (error) throw new Error(`assertConversationOwner: ${error.message}`);
  if (!data) throw new NotFoundError("Conversation not found");
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
  listConversations(userEmail: string): Promise<ConversationSummary[]>;
  getConversation(
    id: string,
    userEmail: string
  ): Promise<{ conversation: ConversationSummary; messages: AgentMessage[] }>;
  deleteConversation(id: string, userEmail: string): Promise<void>;
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
    // Don't let a caller append to a conversation they don't own (the id comes
    // from the client). A conversation just created in persistTurn is owned by
    // this same userEmail, so the check passes for the new-chat path too.
    if (userEmail) await assertConversationOwner(conversationId, userEmail);
    const { error } = await db().from("messages").insert({
      conversation_id: conversationId,
      question,
      payload,
      user_email: userEmail,
    });
    if (error) throw new Error(`appendMessage(insert): ${error.message}`);
    // updated_at on the parent conversation is bumped by a DB trigger
    // (messages_bump_updated_at) on insert — no second round-trip needed.
  },

  async listConversations(userEmail) {
    const { data, error } = await db()
      .from("conversations")
      .select("id, title, created_by_email, updated_at")
      .eq("created_by_email", userEmail)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(`listConversations: ${error.message}`);
    return (data ?? []).map(toSummary);
  },

  async getConversation(id, userEmail) {
    const { data: conv, error: cErr } = await db()
      .from("conversations")
      .select("id, title, created_by_email, updated_at")
      .eq("id", id)
      .eq("created_by_email", userEmail)
      .maybeSingle();
    if (cErr) throw new Error(`getConversation(conversation): ${cErr.message}`);
    if (!conv) throw new NotFoundError("Conversation not found");
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

  async deleteConversation(id, userEmail) {
    const { data, error } = await db()
      .from("conversations")
      .delete()
      .eq("id", id)
      .eq("created_by_email", userEmail)
      .select("id");
    if (error) throw new Error(`deleteConversation: ${error.message}`);
    if (!data || data.length === 0) throw new NotFoundError("Conversation not found");
  },
};

// Persists one completed turn. Returns { conversationId, title } where `title` is
// deriveTitle() of THIS turn's question — authoritative only for a newly-created
// conversation. For an existing conversation the stored title is unchanged; callers
// that display titles should treat the conversation-list endpoint as the source of
// truth (the client refreshes from it) rather than this returned value.
export async function persistTurn(
  store: ConversationStore,
  input: {
    question: string;
    conversationId: string | null;
    userEmail: string | null;
    events: AgentEvent[];
  }
): Promise<{ conversationId: string; title: string }> {
  // id is intentionally "" here; the DB row id is injected by hydrateMessage on read.
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
