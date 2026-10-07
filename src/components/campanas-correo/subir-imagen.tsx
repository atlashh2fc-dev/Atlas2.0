"use client";

import { useId, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { prepararSubidaDeImagen } from "@/app/actions/campanas-correo";
import { Button } from "@/components/ui";

const TIPOS = ["image/png", "image/jpeg", "image/webp"];

/**
 * Sube una imagen directo a Atlas Lead: el CRM pide una URL firmada y el
 * navegador manda el archivo, sin pasar por ningún servidor. Devuelve la URL
 * pública que va en el correo.
 */
export function SubirImagen({
  valor,
  onCambio,
  etiqueta,
  ayuda,
  maxMb = 5,
  disabled,
}: {
  valor: string | null;
  onCambio: (url: string | null) => void;
  etiqueta: string;
  ayuda?: string;
  maxMb?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subir(archivo: File) {
    setError(null);
    if (!TIPOS.includes(archivo.type)) {
      setError("Usa una imagen PNG, JPG o WEBP.");
      return;
    }
    if (archivo.size > maxMb * 1024 * 1024) {
      setError(`La imagen pesa ${(archivo.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB; el máximo es ${maxMb} MB.`);
      return;
    }
    setSubiendo(true);
    try {
      const preparada = await prepararSubidaDeImagen({ nombre: archivo.name, tipo: archivo.type, bytes: archivo.size });
      if (!preparada.ok) throw new Error(preparada.error);
      const cuerpo = new FormData();
      cuerpo.append("cacheControl", "31536000");
      cuerpo.append("", archivo);
      const respuesta = await fetch(preparada.subidaUrl, {
        method: "PUT",
        body: cuerpo,
        headers: { "x-upsert": "false", ...(preparada.clavePublica ? { apikey: preparada.clavePublica } : {}) },
      });
      if (!respuesta.ok) throw new Error("No se pudo subir la imagen. Inténtalo de nuevo.");
      onCambio(preparada.urlPublica);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo subir la imagen.");
    } finally {
      setSubiendo(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground" id={`${id}-label`}>
        {etiqueta}
      </p>
      {valor ? (
        <div className="group relative overflow-hidden rounded-lg border border-border bg-surface-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen externa de Atlas Lead, tal cual sale en el correo */}
          <img src={valor} alt="" className="max-h-44 w-full object-contain" />
          {!disabled && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="absolute right-2 top-2"
              onClick={() => onCambio(null)}
              aria-label={`Quitar ${etiqueta.toLowerCase()}`}
            >
              <X size={14} aria-hidden="true" /> Quitar
            </Button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || subiendo}
          aria-labelledby={`${id}-label`}
          onClick={() => input.current?.click()}
          onDragOver={(evento) => evento.preventDefault()}
          onDrop={(evento) => {
            evento.preventDefault();
            const archivo = evento.dataTransfer.files?.[0];
            if (archivo && !disabled) void subir(archivo);
          }}
          className="flex min-h-[88px] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-strong/70 bg-surface px-4 py-4 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {subiendo ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={18} aria-hidden="true" />}
          <span>{subiendo ? "Subiendo…" : "Arrastra una imagen o haz clic para elegirla"}</span>
          <span className="text-xs">PNG, JPG o WEBP · hasta {maxMb} MB</span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={TIPOS.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(evento) => {
          const archivo = evento.target.files?.[0];
          if (archivo) void subir(archivo);
        }}
      />
      {ayuda && !error && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
