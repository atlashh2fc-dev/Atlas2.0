"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, LoaderCircle, RotateCcw, WandSparkles } from "lucide-react";
import { Badge, Button, SlideOver, useToast } from "@/components/ui";

export type TranscriptionStatus = "pending" | "processing" | "completed" | "failed";

type Segment = {
  start?: number;
  end?: number;
  text?: string;
};

type TranscriptionPayload = {
  status?: TranscriptionStatus;
  languageCode?: string | null;
  text?: string | null;
  segments?: Segment[];
  completedAt?: string | null;
  error?: string;
  message?: string;
};

function formatTimestamp(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export function RecordingTranscriptionControl({
  recordingId,
  playable,
  initialStatus,
  eligible,
  eligibilityLabel,
}: {
  recordingId: string;
  playable: boolean;
  initialStatus: TranscriptionStatus | null;
  eligible: boolean;
  eligibilityLabel: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [status, setStatus] = useState<TranscriptionStatus | null>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [transcription, setTranscription] = useState<TranscriptionPayload | null>(null);

  const request = async (method: "GET" | "POST") => {
    const response = await fetch(
      `/api/calidad/grabaciones/${encodeURIComponent(recordingId)}/transcribe`,
      { method, cache: "no-store" }
    );
    const payload = (await response.json()) as TranscriptionPayload;
    if (!response.ok) throw new Error(payload.error ?? payload.message ?? "No se pudo procesar la transcripción.");
    return payload;
  };

  const transcribe = async () => {
    setLoading(true);
    setStatus("processing");
    try {
      const payload = await request("POST");
      setStatus(payload.status ?? "completed");
      setTranscription(payload);
      setOpen(true);
      toast({ tone: "success", message: "Grabación transcrita correctamente." });
      router.refresh();
    } catch (error) {
      setStatus(initialStatus === "completed" ? "completed" : "failed");
      toast({
        tone: "danger",
        message: error instanceof Error ? error.message : "No se pudo transcribir la grabación.",
      });
    } finally {
      setLoading(false);
    }
  };

  const view = async () => {
    setOpen(true);
    if (transcription?.text) return;
    setLoading(true);
    try {
      const payload = await request("GET");
      setStatus(payload.status ?? status);
      setTranscription(payload);
    } catch (error) {
      setOpen(false);
      toast({
        tone: "danger",
        message: error instanceof Error ? error.message : "No se pudo cargar la transcripción.",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!playable) return <span className="text-xs text-muted-foreground">No disponible</span>;

  if (!eligible && status !== "completed" && status !== "processing") {
    return (
      <span className="whitespace-nowrap text-xs text-muted-foreground" title={eligibilityLabel}>
        No seleccionada
      </span>
    );
  }

  return (
    <>
      {status === "completed" ? (
        <Button type="button" variant="secondary" size="sm" onClick={view} disabled={loading}>
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : <FileText size={14} />}
          Ver texto
        </Button>
      ) : status === "processing" || loading ? (
        <Badge tone="info">
          <LoaderCircle size={13} className="animate-spin" />
          Procesando
        </Badge>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={transcribe}>
          {status === "failed" ? <RotateCcw size={14} /> : <WandSparkles size={14} />}
          {status === "failed" ? "Reintentar" : "Transcribir"}
        </Button>
      )}

      <SlideOver
        open={open}
        onClose={() => setOpen(false)}
        title="Transcripción de la llamada"
        description="Generada con Groq Whisper Large V3. No distingue automáticamente entre ejecutivo y cliente."
        width="lg"
      >
        {loading && !transcription?.text ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle size={16} className="animate-spin" />
            Cargando transcripción…
          </div>
        ) : transcription?.text ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">Completada</Badge>
              {transcription.languageCode && <Badge tone="neutral">Idioma: {transcription.languageCode}</Badge>}
            </div>

            {transcription.segments && transcription.segments.length > 0 ? (
              <div className="space-y-3">
                {transcription.segments.map((segment, index) => (
                  <div key={`${segment.start ?? index}-${index}`} className="grid grid-cols-[3.5rem_1fr] gap-3">
                    <span className="pt-0.5 text-xs tabular-nums text-muted-foreground">
                      {formatTimestamp(segment.start)}
                    </span>
                    <p className="text-sm leading-6 text-foreground">{segment.text?.trim()}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{transcription.text}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">La transcripción todavía no está disponible.</p>
        )}
      </SlideOver>
    </>
  );
}
