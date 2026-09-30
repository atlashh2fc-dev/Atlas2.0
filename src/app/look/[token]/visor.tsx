"use client";

import dynamic from "next/dynamic";

const Visor3D = dynamic(() => import("@/components/barber/visor-3d").then((modulo) => modulo.Visor3D), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-white/60">Cargando tu look en 3D…</div>,
});

/** El look del cliente en 3D, para girarlo con el dedo. */
export function VisorDelLook({ url }: { url: string }) {
  return (
    <div className="relative h-[440px] overflow-hidden rounded-2xl sm:h-[520px]">
      <Visor3D url={url} />
      <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-3 py-1 text-[11px] text-white/85 backdrop-blur">Gíralo con el dedo</span>
    </div>
  );
}
