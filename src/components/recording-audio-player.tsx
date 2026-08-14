"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, Play } from "lucide-react";
import { buttonClasses } from "@/components/ui";

export function RecordingAudioPlayer({ recordingId, playable }: { recordingId: string; playable: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const load = async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/calidad/grabaciones/${encodeURIComponent(recordingId)}/play`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error ?? "No se pudo abrir el audio.");
      setUrl(payload.url);
    } catch (requestError) {
      if ((requestError as Error).name !== "AbortError") {
        setError(requestError instanceof Error ? requestError.message : "No se pudo abrir el audio.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  if (!playable) {
    return <span className="text-xs text-muted-foreground">No disponible</span>;
  }

  if (url) {
    return (
      <audio
        controls
        preload="metadata"
        src={url}
        className="h-8 w-64 max-w-full"
        aria-label="Reproducir grabación de llamada"
        onError={() => {
          setUrl(null);
          setError("El enlace venció o el audio no está disponible. Intenta nuevamente.");
        }}
      />
    );
  }

  return (
    <div className="flex min-w-44 items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className={buttonClasses({ variant: "secondary", size: "sm" })}
      >
        {loading ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />}
        {loading ? "Preparando" : "Escuchar"}
      </button>
      {error && (
        <span title={error} className="inline-flex items-center gap-1 text-xs text-danger">
          <CircleAlert size={14} />
          Reintentar
        </span>
      )}
    </div>
  );
}
