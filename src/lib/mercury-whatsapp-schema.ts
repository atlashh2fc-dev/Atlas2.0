import { z } from "zod";

export const MAX_MERCURY_WHATSAPP_REPLY_LENGTH = 2000;

export const mercuryWhatsAppReplySchema = z.object({
  reply: z.string().trim().min(1).max(MAX_MERCURY_WHATSAPP_REPLY_LENGTH),
  handoff: z.boolean(),
  handoff_reason: z.string().trim().max(500),
});
