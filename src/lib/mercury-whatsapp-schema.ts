import { z } from "zod";

// A WhatsApp answer must feel like a turn in a conversation, not a brochure.
export const MAX_MERCURY_WHATSAPP_REPLY_LENGTH = 420;

export const mercuryWhatsAppHandoffKindSchema = z.enum([
  "none",
  "human_requested",
  "appointment",
  "quote",
  "unknown",
  "complaint",
]);

export type MercuryWhatsAppHandoffKind = z.infer<typeof mercuryWhatsAppHandoffKindSchema>;

export const mercuryWhatsAppReplySchema = z.object({
  reply: z.string().trim().min(1).max(MAX_MERCURY_WHATSAPP_REPLY_LENGTH),
  handoff: z.boolean(),
  handoff_kind: mercuryWhatsAppHandoffKindSchema,
  handoff_reason: z.string().trim().max(500),
  appointment_at: z.string().datetime({ offset: true }).nullable(),
}).superRefine((value, context) => {
  if (!value.handoff && value.handoff_kind !== "none") {
    context.addIssue({ code: "custom", path: ["handoff_kind"], message: "handoff_kind debe ser none." });
  }
  if (value.handoff && value.handoff_kind === "none") {
    context.addIssue({ code: "custom", path: ["handoff_kind"], message: "La derivación requiere un tipo." });
  }
  if (value.handoff && !value.handoff_reason) {
    context.addIssue({ code: "custom", path: ["handoff_reason"], message: "La derivación requiere un motivo." });
  }
  if (value.handoff_kind !== "appointment" && value.appointment_at !== null) {
    context.addIssue({ code: "custom", path: ["appointment_at"], message: "Solo un agendamiento puede incluir fecha." });
  }
});
