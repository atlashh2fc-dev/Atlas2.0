"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Box, Loader2, RotateCcw } from "lucide-react";

import { useToast } from "@/components/ui";

const Visor3D = dynamic(() => import("./visor-3d").then((modulo) => modulo.Visor3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-white/60">
      <Box size={18} className="mr-2 animate-pulse" aria-hidden="true" /> Cargando el 3D…
    </div>
  ),
});

export type Modelo3D = { estado: "generando" | "listo" | "fallido"; url: string | null } | null;

/** Pide el 3D de un look (sin propuesta: el cliente tal como llegó). */
export async function pedirModelo3D(lookId: string, propuestaId: string | null): Promise<string | null> {
  const respuesta = await fetch(`/api/looks/${lookId}/modelo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(propuestaId ? { propuesta: propuestaId } : {}),
  }).catch(() => null);
  if (!respuesta) return "No se pudo pedir el 3D. Revisa la conexión.";
  if (respuesta.ok) return null;
  const datos = (await respuesta.json().catch(() => ({}))) as { error?: string };
  return datos.error ?? "No se pudo pedir el 3D.";
}

/**
 * El escenario 3D: el modelo girando cuando está listo; mientras se arma, la
 * foto de fondo con el avance; si no se ha pedido, la acción para pedirlo.
 * Mientras se arma consulta cada seis segundos, sin que nadie tenga que
 * recargar.
 */
export function Escena3D({
  lookId,
  propuestaId,
  inicial,
  fondo,
  titulo,
  disponible,
  puedePedir,
  sinPoder,
}: {
  lookId: string;
  propuestaId: string | null;
  inicial: Modelo3D;
  fondo: string | null;
  titulo: string;
  disponible: boolean;
  puedePedir: boolean;
  sinPoder: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [local, setLocal] = useState<Modelo3D>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const modelo = local ?? inicial;
  const esperando = modelo?.estado === "generando";

  useEffect(() => {
    if (!esperando) return;
    let vivo = true;
    const reloj = window.setInterval(async () => {
      const respuesta = await fetch(`/api/looks/${lookId}/modelo${propuestaId ? `?propuesta=${propuestaId}` : ""}`).catch(() => null);
      const datos = (await respuesta?.json().catch(() => null)) as { estado?: "generando" | "listo" | "fallido"; url?: string | null; error?: string } | null;
      if (!vivo || !datos?.estado || datos.estado === "generando") return;
      setLocal({ estado: datos.estado, url: datos.url ?? null });
      if (datos.estado === "fallido") toast({ tone: "danger", message: datos.error ?? "El 3D no se pudo armar." });
    }, 6000);
    return () => {
      vivo = false;
      window.clearInterval(reloj);
    };
  }, [esperando, lookId, propuestaId, toast]);

  const pedir = async () => {
    setPidiendo(true);
    const error = await pedirModelo3D(lookId, propuestaId);
    setPidiendo(false);
    if (error) {
      toast({ tone: "danger", message: error });
      return;
    }
    setLocal({ estado: "generando", url: null });
    router.refresh();
  };

  if (modelo?.estado === "listo" && modelo.url) {
    return (
      <div className="relative h-full w-full">
        <Visor3D url={modelo.url} />
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs text-white backdrop-blur">{titulo}</span>
        <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[11px] text-white/80 backdrop-blur">
          Arrastra para girar · pellizca para acercar
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {fondo && (
        // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado
        <img src={fondo} alt="" className={`absolute inset-0 h-full w-full object-contain ${esperando ? "opacity-45 blur-[1px]" : "opacity-30"}`} />
      )}
      <div className="relative flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        {esperando ? (
          <>
            <Loader2 size={26} className="animate-spin text-[#e0b36e]" aria-hidden="true" />
            <p className="text-sm font-medium text-white">Armando {titulo.toLowerCase()} en 3D…</p>
            <p className="max-w-xs text-xs text-white/70">Tarda entre 1 y 3 minutos. Puedes seguir con el análisis y las propuestas; aparece solo.</p>
          </>
        ) : !disponible ? (
          <>
            <Box size={26} className="text-[#e0b36e]" aria-hidden="true" />
            <p className="max-w-sm text-sm text-white/85">El 3D todavía no está activo en esta barbería. Se activa con la cuenta de fal.ai en la configuración de Atlas.</p>
          </>
        ) : !puedePedir ? (
          <>
            <Box size={26} className="text-[#e0b36e]" aria-hidden="true" />
            <p className="max-w-sm text-sm text-white/85">{sinPoder}</p>
          </>
        ) : (
          <>
            <Box size={26} className="text-[#e0b36e]" aria-hidden="true" />
            <p className="max-w-sm text-sm text-white/85">{modelo?.estado === "fallido" ? "El intento anterior no resultó. Prueba otra vez." : `Arma ${titulo.toLowerCase()} en 3D para girarlo y verlo desde cualquier ángulo.`}</p>
            <button
              type="button"
              onClick={() => void pedir()}
              disabled={pidiendo}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-[#e0b36e] px-5 text-sm font-semibold text-[#e0b36e] transition-colors hover:bg-[#e0b36e]/10 disabled:opacity-60"
            >
              {pidiendo ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : modelo?.estado === "fallido" ? <RotateCcw size={16} aria-hidden="true" /> : <Box size={16} aria-hidden="true" />}
              {modelo?.estado === "fallido" ? "Reintentar el 3D" : "Armar en 3D"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
