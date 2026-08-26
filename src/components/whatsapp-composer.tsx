"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileAudio, ImageIcon, Paperclip, Send, SmilePlus, X } from "lucide-react";

import {
  prepareWhatsAppMediaUpload,
  sendPreparedWhatsAppMedia,
  sendWhatsAppMessage,
} from "@/app/actions/whatsapp";
import { ActionForm, ActionSubmit, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const EMOJIS = [
  "😀", "😊", "😂", "😍", "👍", "👏", "🙏", "✅",
  "👋", "💬", "📞", "📅", "📍", "💡", "🚀", "❤️",
];
const MEDIA_ACCEPT = "image/jpeg,image/png,audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg,audio/opus";
const MEDIA_BUCKET = "whatsapp-media";

export function WhatsAppComposer({
  conversationId,
  disabled,
}: {
  conversationId: string;
  disabled: boolean;
}) {
  const [body, setBody] = useState("");
  const [showEmojis, setShowEmojis] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(
    () => attachment?.type.startsWith("image/") ? URL.createObjectURL(attachment) : null,
    [attachment],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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

  async function submitMessage(formData: FormData) {
    if (!attachment) {
      await sendWhatsAppMessage(formData);
      return;
    }

    const prepared = await prepareWhatsAppMediaUpload({
      conversationId,
      fileName: attachment.name,
      mimeType: attachment.type,
      sizeBytes: attachment.size,
    });
    const supabase = createClient();
    const { error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .uploadToSignedUrl(prepared.storagePath, prepared.token, attachment, {
        contentType: attachment.type,
        upsert: false,
      });
    if (error) throw new Error("No se pudo subir el adjunto. Revisa el formato y vuelve a intentarlo.");
    await sendPreparedWhatsAppMedia({
      uploadId: prepared.uploadId,
      caption: attachment.type.startsWith("image/") ? body : "",
    });
  }

  function clearComposer() {
    if (!attachment?.type.startsWith("audio/")) setBody("");
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeAttachment() {
    setAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <ActionForm
      action={submitMessage}
      success={attachment ? "Adjunto enviado" : "Mensaje enviado"}
      className="flex items-end gap-2"
      onSuccess={clearComposer}
    >
      <input type="hidden" name="conversation_id" value={conversationId} />
      <input
        ref={fileInputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
        aria-label="Adjuntar imagen o audio"
      />
      <div className="relative min-w-0 flex-1 rounded-md border border-border bg-background focus-within:ring-2 focus-within:ring-ring">
        {attachment && (
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Vista previa" className="h-12 w-12 rounded object-cover" />
            ) : (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-surface-muted text-primary">
                <FileAudio size={19} aria-hidden />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{attachment.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {attachment.type.startsWith("image/") ? "Imagen" : "Audio"} · {(attachment.size / 1024 / 1024).toLocaleString("es-CL", { maximumFractionDigits: 1 })} MB
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Quitar adjunto"
              onClick={removeAttachment}
              className="shrink-0 px-2"
            >
              <X size={16} />
            </Button>
          </div>
        )}
        <div className="flex items-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label="Adjuntar imagen o audio"
            onClick={() => fileInputRef.current?.click()}
            className="mb-1 ml-1 shrink-0 px-2 text-muted-foreground"
          >
            <Paperclip size={18} />
          </Button>
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
          required={!attachment}
          disabled={disabled}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (body.trim() || attachment) event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={attachment?.type.startsWith("audio/") ? "El audio se enviará sin texto adjunto" : attachment ? "Agrega un texto opcional a la imagen…" : "Escribe una respuesta…"}
          aria-label="Mensaje de WhatsApp"
          className="min-h-16 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
          />
        </div>
      </div>
      <ActionSubmit disabled={disabled || (!body.trim() && !attachment)} pendingLabel={attachment ? "Subiendo…" : "Enviando…"}>
        {attachment?.type.startsWith("image/") ? <ImageIcon size={15} /> : <Send size={15} />} Enviar
      </ActionSubmit>
    </ActionForm>
  );
}
