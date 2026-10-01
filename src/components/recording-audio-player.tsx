"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

/**
 * Reproductor de grabaciones al estilo de Gong: un botón redondo de reproducir,
 * la línea de avance y los tiempos. El enlace firmado se pide recién al primer
 * clic (vence rápido), y desde ahí el mismo botón pausa y reanuda.
 */
export function RecordingAudioPlayer({
  recordingId,
  playable,
  compact = false,
}: {
  recordingId: string;
  playable: boolean;
  compact?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  const toggle = () => {
    const audio = audioRef.current;
    if (!url || !audio) {
      void load();
      return;
    }
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  };

  if (!playable) {
    return <span className="text-xs text-muted-foreground">Audio no disponible</span>;
  }

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  return (
    <div
      className={cn("flex min-w-0 items-center gap-2.5", compact ? "w-full" : "w-full max-w-sm")}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        aria-label={playing ? "Pausar grabación" : "Reproducir grabación"}
        title={error ?? undefined}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:opacity-60",
          compact ? "size-8" : "size-10",
          playing
            ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover"
            : "bg-primary/10 text-primary hover:bg-primary/15"
        )}
      >
        {loading ? (
          <LoaderCircle size={compact ? 14 : 16} className="animate-spin" aria-hidden="true" />
        ) : playing ? (
          <Pause size={compact ? 13 : 15} className="fill-current" aria-hidden="true" />
        ) : (
          <Play size={compact ? 13 : 15} className="ml-0.5 fill-current" aria-hidden="true" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        {url ? (
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            aria-label="Avance de la grabación"
            onChange={(event) => {
              const audio = audioRef.current;
              const next = Number(event.target.value);
              if (audio) audio.currentTime = next;
              setCurrent(next);
            }}
            className="block h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm"
            style={{
              background: `linear-gradient(90deg, var(--primary) ${progress}%, var(--surface-muted) ${progress}%)`,
            }}
          />
        ) : (
          <div className="h-1.5 rounded-full bg-surface-muted" aria-hidden="true" />
        )}
        <p className="mt-1 flex items-center justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
          {error ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-danger">
              <CircleAlert size={12} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{compact ? "Reintentar" : error}</span>
            </span>
          ) : (
            <span>{url ? clock(current) : loading ? "Preparando…" : "Escuchar"}</span>
          )}
          {url && duration > 0 && <span>{clock(duration)}</span>}
        </p>
      </div>

      {url && (
        <audio
          ref={audioRef}
          preload="metadata"
          autoPlay
          src={url}
          className="hidden"
          aria-label="Grabación de llamada"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onDurationChange={(event) => setDuration(event.currentTarget.duration)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onError={() => {
            setUrl(null);
            setPlaying(false);
            setCurrent(0);
            setDuration(0);
            setError("El enlace venció o el audio no está disponible. Intenta nuevamente.");
          }}
        />
      )}
    </div>
  );
}
