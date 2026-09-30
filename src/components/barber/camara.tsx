"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, RefreshCcw, RotateCcw } from "lucide-react";

import { reducirFoto } from "./tipos";

/**
 * La cámara del Estudio: video en vivo con una guía para encuadrar la cara y
 * un botón grande para disparar. Si el navegador no da cámara (o el barbero
 * prefiere), la foto se elige desde la galería o la cámara del sistema.
 */
export function Camara({
  guia,
  onFoto,
  foto,
  onRepetir,
}: {
  guia: "frente" | "perfil";
  onFoto: (blob: Blob) => void;
  foto: string | null;
  onRepetir: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const [flujo, setFlujo] = useState<MediaStream | null>(null);
  const [frontal, setFrontal] = useState(false);
  const [estado, setEstado] = useState<"apagada" | "pidiendo" | "lista" | "sin_camara">("apagada");

  const apagar = useCallback(() => {
    setFlujo((actual) => {
      actual?.getTracks().forEach((pista) => pista.stop());
      return null;
    });
  }, []);

  const encender = useCallback(
    async (usarFrontal: boolean) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setEstado("sin_camara");
        return;
      }
      setEstado("pidiendo");
      try {
        const nuevo = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: usarFrontal ? "user" : { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        setFlujo((actual) => {
          actual?.getTracks().forEach((pista) => pista.stop());
          return nuevo;
        });
        setEstado("lista");
      } catch {
        setEstado("sin_camara");
      }
    },
    [],
  );

  useEffect(() => {
    if (video.current && flujo) {
      video.current.srcObject = flujo;
      void video.current.play().catch(() => undefined);
    }
  }, [flujo]);

  useEffect(() => () => apagar(), [apagar]);

  const disparar = async () => {
    const fuente = video.current;
    if (!fuente || !fuente.videoWidth) return;
    const lienzo = document.createElement("canvas");
    lienzo.width = fuente.videoWidth;
    lienzo.height = fuente.videoHeight;
    const contexto = lienzo.getContext("2d");
    if (!contexto) return;
    if (frontal) {
      contexto.translate(lienzo.width, 0);
      contexto.scale(-1, 1);
    }
    contexto.drawImage(fuente, 0, 0);
    apagar();
    setEstado("apagada");
    onFoto(await reducirFoto(lienzo));
  };

  if (foto) {
    return (
      <div className="relative h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- foto local recién tomada */}
        <img src={foto} alt="Foto tomada" className="h-full w-full object-contain" />
        <button
          type="button"
          onClick={onRepetir}
          className="absolute bottom-4 left-1/2 inline-flex h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-5 text-sm font-medium text-white backdrop-blur hover:bg-black/75"
        >
          <RotateCcw size={16} aria-hidden="true" /> Repetir foto
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      {estado === "lista" ? (
        <>
          <video ref={video} playsInline muted className={`h-full w-full object-cover ${frontal ? "-scale-x-100" : ""}`} />
          {/* Guía de encuadre: la cara dentro del óvalo, hombros abajo. */}
          <svg viewBox="0 0 100 125" preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
            <defs>
              <mask id={`hueco-${guia}`}>
                <rect width="100" height="125" fill="white" />
                {guia === "frente" ? <ellipse cx="50" cy="52" rx="23" ry="31" fill="black" /> : <ellipse cx="50" cy="52" rx="21" ry="30" fill="black" />}
              </mask>
            </defs>
            <rect width="100" height="125" fill="rgba(10,8,6,0.45)" mask={`url(#hueco-${guia})`} />
            <ellipse cx="50" cy="52" rx={guia === "frente" ? 23 : 21} ry={guia === "frente" ? 31 : 30} fill="none" stroke="#e0b36e" strokeWidth="0.6" strokeDasharray="2 1.5" />
          </svg>
          <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white backdrop-blur">
            {guia === "frente" ? "Cara al frente, dentro del óvalo, con luz pareja" : "De perfil, con la oreja a la vista"}
          </p>
          <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => {
                const siguiente = !frontal;
                setFrontal(siguiente);
                void encender(siguiente);
              }}
              aria-label="Cambiar de cámara"
              className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/70"
            >
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => void disparar()}
              aria-label="Tomar foto"
              className="flex size-16 items-center justify-center rounded-full border-4 border-white bg-white/25 backdrop-blur transition-transform hover:scale-105 active:scale-95"
            >
              <span className="size-11 rounded-full bg-white" />
            </button>
            <button
              type="button"
              onClick={() => archivo.current?.click()}
              aria-label="Elegir foto de la galería"
              className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/70"
            >
              <ImageUp size={18} aria-hidden="true" />
            </button>
          </div>
        </>
      ) : (
        <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-white/10 text-[#e0b36e]">
            <Camera size={26} aria-hidden="true" />
          </span>
          <p className="text-sm text-white/80">
            {estado === "sin_camara"
              ? "No pudimos abrir la cámara del navegador. Toma la foto con la cámara del equipo o elígela de la galería."
              : guia === "frente"
                ? "Foto de frente, con la cara despejada y buena luz. Es la base del análisis y de la simulación."
                : "Una foto de perfil mejora la simulación de los lados y la nuca. Es opcional."}
          </p>
          {estado !== "sin_camara" && (
            <button
              type="button"
              onClick={() => void encender(frontal)}
              disabled={estado === "pidiendo"}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-[#e0b36e] px-5 text-sm font-semibold text-[#1c1a17] transition-colors hover:bg-[#ecc587] disabled:opacity-60"
            >
              <Camera size={16} aria-hidden="true" /> {estado === "pidiendo" ? "Abriendo la cámara…" : "Abrir cámara"}
            </button>
          )}
          <button
            type="button"
            onClick={() => archivo.current?.click()}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-white/25 px-5 text-sm font-medium text-white hover:bg-white/10"
          >
            <ImageUp size={16} aria-hidden="true" /> {estado === "sin_camara" ? "Tomar o elegir foto" : "Elegir de la galería"}
          </button>
        </div>
      )}
      <input
        ref={archivo}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        capture={guia === "frente" ? "user" : "environment"}
        className="hidden"
        onChange={async (evento) => {
          const elegido = evento.target.files?.[0];
          evento.target.value = "";
          if (elegido) {
            apagar();
            setEstado("apagada");
            onFoto(await reducirFoto(elegido));
          }
        }}
      />
    </div>
  );
}
