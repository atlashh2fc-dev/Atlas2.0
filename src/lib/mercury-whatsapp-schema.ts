import { z } from "zod";

export const MAX_MERCURY_WHATSAPP_REPLY_LENGTH = 2000;

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
});
