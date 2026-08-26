import { FileAudio, ImageIcon } from "lucide-react";

export function WhatsAppMessageMedia({
  messageId,
  messageType,
  mimeType,
  fileName,
}: {
  messageId: string;
  messageType: string;
  mimeType: string | null;
  fileName: string | null;
}) {
  const mediaUrl = `/api/conversaciones/whatsapp/mensajes/${messageId}/media`;
  if (messageType === "image") {
    return (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noreferrer"
        className="mb-2 block overflow-hidden rounded-lg bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Abrir imagen en tamaño completo"
      >
        {/* La ruta es autenticada y redirige a una URL privada de corta vida. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl}
          alt={fileName ? `Imagen adjunta: ${fileName}` : "Imagen adjunta por WhatsApp"}
          loading="lazy"
          className="max-h-96 w-full min-w-40 object-contain"
        />
      </a>
    );
  }

  if (messageType === "audio") {
    return (
      <div className="mb-1 min-w-64 max-w-full">
        <div className="mb-1 flex items-center gap-1.5 text-xs opacity-80">
          <FileAudio size={14} aria-hidden />
          <span className="truncate">{fileName || "Audio de WhatsApp"}</span>
        </div>
        <audio controls preload="metadata" className="h-10 w-full max-w-sm" aria-label="Reproducir audio de WhatsApp">
          <source src={mediaUrl} type={mimeType ?? undefined} />
          Tu navegador no puede reproducir este audio.
        </audio>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <ImageIcon size={14} aria-hidden /> Adjunto de WhatsApp
    </span>
  );
}
