"use client";

import { useRef, useState } from "react";
import { Send, SmilePlus } from "lucide-react";

import { sendWhatsAppMessage } from "@/app/actions/whatsapp";
import { ActionForm, ActionSubmit, Button } from "@/components/ui";

const EMOJIS = [
  "😀", "😊", "😂", "😍", "👍", "👏", "🙏", "✅",
  "👋", "💬", "📞", "📅", "📍", "💡", "🚀", "❤️",
];

export function WhatsAppComposer({
  conversationId,
  disabled,
}: {
  conversationId: string;
  disabled: boolean;
}) {
  const [body, setBody] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    setBody(`${body.slice(0, start)}${emoji}${body.slice(end)}`);
    setShowEmojis(false);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  return (
    <ActionForm
      action={sendWhatsAppMessage}
      success="Mensaje enviado"
      className="flex items-end gap-2"
      onSuccess={() => setBody("")}
    >
      <input type="hidden" name="conversation_id" value={conversationId} />
      <div className="relative flex min-w-0 flex-1 items-end rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label="Agregar emoji"
          aria-expanded={showEmojis}
          onClick={() => setShowEmojis((visible) => !visible)}
          className="mb-1 ml-1 shrink-0 px-2 text-muted-foreground"
        >
          <SmilePlus size={18} />
        </Button>
        {showEmojis && (
          <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 grid w-56 grid-cols-8 gap-1 rounded-lg border border-border bg-surface p-2 shadow-lg">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => insertEmoji(emoji)}
                className="rounded p-1 text-lg leading-none hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          name="body"
          rows={2}
          maxLength={4096}
          required
          disabled={disabled}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (body.trim()) event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Escribe una respuesta…"
          aria-label="Mensaje de WhatsApp"
          className="min-h-16 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
        />
      </div>
      <ActionSubmit disabled={disabled || !body.trim()} pendingLabel="Enviando…">
        <Send size={15} /> Enviar
      </ActionSubmit>
    </ActionForm>
  );
}
