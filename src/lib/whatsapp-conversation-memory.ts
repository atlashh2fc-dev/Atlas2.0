import { z } from "zod";

import { createAdminClient } from "./supabase/admin.ts";

const memoryItemSchema = z.string().trim().min(1).max(240);

export const whatsappConversationMemorySchema = z.object({
  summary: z.string().trim().max(1200),
  customer_facts: z.array(memoryItemSchema).max(16),
  needs: z.array(memoryItemSchema).max(12),
  service_interests: z.array(memoryItemSchema).max(10),
  objections: z.array(memoryItemSchema).max(8),
  commitments: z.array(memoryItemSchema).max(10),
  open_items: z.array(memoryItemSchema).max(10),
});

export type WhatsAppConversationMemory = z.infer<typeof whatsappConversationMemorySchema>;

export const EMPTY_WHATSAPP_CONVERSATION_MEMORY: WhatsAppConversationMemory = {
  summary: "",
  customer_facts: [],
  needs: [],
  service_interests: [],
  objections: [],
  commitments: [],
  open_items: [],
};

export const whatsappConversationMemoryJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", maxLength: 1200 },
    customer_facts: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 240 } },
    needs: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 240 } },
    service_interests: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 240 } },
    objections: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 240 } },
    commitments: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 240 } },
    open_items: { type: "array", maxItems: 10, items: { type: "string", minLength: 1, maxLength: 240 } },
  },
  required: ["summary", "customer_facts", "needs", "service_interests", "objections", "commitments", "open_items"],
} as const;

export type WhatsAppMemoryMessage = {
  id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  text_body: string | null;
  sent_by: string | null;
  created_at: string;
};

export async function loadWhatsAppConversationMemory(conversationId: string) {
  const admin = createAdminClient();
  const [memoryResult, candidatesResult] = await Promise.all([
    admin
      .from("whatsapp_conversation_memories")
      .select("memory")
      .eq("conversation_id", conversationId)
      .maybeSingle(),
    admin.rpc("get_whatsapp_memory_candidates", {
      p_conversation_id: conversationId,
      p_limit: 120,
    }),
  ]);

  if (memoryResult.error) throw new Error(`No se pudo leer la memoria conversacional: ${memoryResult.error.message}`);
  if (candidatesResult.error) throw new Error(`No se pudo leer el contexto histórico: ${candidatesResult.error.message}`);

  const parsedMemory = memoryResult.data?.memory
    ? whatsappConversationMemorySchema.safeParse(memoryResult.data.memory)
    : null;

  return {
    memory: parsedMemory?.success ? parsedMemory.data : EMPTY_WHATSAPP_CONVERSATION_MEMORY,
    messages: (candidatesResult.data ?? []) as WhatsAppMemoryMessage[],
  };
}

export async function saveWhatsAppConversationMemory(input: {
  conversationId: string;
  memory: WhatsAppConversationMemory;
  messageIds: string[];
  model: string;
}) {
  const admin = createAdminClient();
  const memory = whatsappConversationMemorySchema.parse(input.memory);
  const messageIds = [...new Set(input.messageIds)];
  if (messageIds.length === 0) return;

  const { error } = await admin.rpc("save_whatsapp_conversation_memory", {
    p_conversation_id: input.conversationId,
    p_memory: memory,
    p_message_ids: messageIds,
    p_model: input.model,
  });
  if (error) throw new Error(`No se pudo guardar la memoria conversacional: ${error.message}`);
}
