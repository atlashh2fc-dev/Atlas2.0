"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

const MIC_KEY = "atlas.cti.mic";
const SPEAKER_KEY = "atlas.cti.speaker";
const TEST_SECONDS = 5;

export type AudioDevicePreference = { micId: string; speakerId: string };

export function readAudioPreference(): AudioDevicePreference {
  try {
    return {
      micId: window.localStorage.getItem(MIC_KEY) ?? "",
      speakerId: window.localStorage.getItem(SPEAKER_KEY) ?? "",
    };
  } catch {
    return { micId: "", speakerId: "" };
  }
}

function saveAudioPreference(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* la preferencia es opcional: sin storage se usa el dispositivo del sistema */
  }
}

export function speakerSelectionSupported(): boolean {
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/**
 * Micrófono y audífono del puesto, y una prueba de micrófono de 5 segundos.
 * Un audífono mal elegido era la causa típica de "el cliente no me escucha":
 * ahora el ejecutivo lo comprueba antes de ponerse Disponible.
 */
export function AudioSettings({
  value,
  onChange,
  disabled,
}: {
  value: AudioDevicePreference;
  onChange: (next: AudioDevicePreference) => void;
  disabled?: boolean;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const stopTestRef = useRef<(() => void) | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices?.enumerateDevices?.();
      setDevices(list ?? []);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadDevices());
    navigator.mediaDevices?.addEventListener?.("devicechange", loadDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", loadDevices);
      stopTestRef.current?.();
    };
  }, [loadDevices]);

  const mics = devices.filter((device) => device.kind === "audioinput" && device.deviceId);
  const speakers = devices.filter((device) => device.kind === "audiooutput" && device.deviceId);

  async function testMicrophone() {
    stopTestRef.current?.();
    setTestError(null);
    setTesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: value.micId ? { deviceId: { ideal: value.micId } } : true,
        video: false,
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
        setLevel(Math.min(1, peak / 64));
        frame = requestAnimationFrame(tick);
      };
      tick();
      const stop = () => {
        cancelAnimationFrame(frame);
        stream.getTracks().forEach((track) => track.stop());
        void context.close().catch(() => undefined);
        setTesting(false);
        setLevel(0);
        stopTestRef.current = null;
      };
      stopTestRef.current = stop;
      setTimeout(() => {
        if (stopTestRef.current === stop) stop();
      }, TEST_SECONDS * 1000);
      // Con permiso concedido el navegador ya entrega los nombres reales.
      void loadDevices();
    } catch {
      setTesting(false);
      setTestError("No se pudo abrir el micrófono. Revisa el permiso del navegador.");
    }
  }

  return (
    <div className="space-y-2.5">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Micrófono</span>
        <select
          value={value.micId}
          disabled={disabled}
          onChange={(event) => {
            saveAudioPreference(MIC_KEY, event.target.value);
            onChange({ ...value, micId: event.target.value });
          }}
          className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground disabled:opacity-60"
        >
          <option value="">Predeterminado del sistema</option>
          {mics.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Micrófono ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      {speakerSelectionSupported() && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Audífono</span>
          <select
            value={value.speakerId}
            disabled={disabled}
            onChange={(event) => {
              saveAudioPreference(SPEAKER_KEY, event.target.value);
              onChange({ ...value, speakerId: event.target.value });
            }}
            className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground disabled:opacity-60"
          >
            <option value="">Predeterminado del sistema</option>
            {speakers.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Salida ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => (testing ? stopTestRef.current?.() : void testMicrophone())}
          disabled={disabled}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-muted disabled:opacity-50"
        >
          <Mic size={14} aria-hidden="true" />
          {testing ? "Detener" : "Probar micrófono"}
        </button>
        <span
          className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted"
          role="meter"
          aria-label="Nivel del micrófono"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <span
            className={cn("block h-full rounded-full transition-[width] duration-75", level > 0.08 ? "bg-success" : "bg-muted-foreground")}
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </span>
      </div>
      {testing && <p className="text-xs text-muted-foreground">Habla: la barra debe moverse.</p>}
      {testError && <p role="alert" className="text-xs text-danger">{testError}</p>}
    </div>
  );
}
