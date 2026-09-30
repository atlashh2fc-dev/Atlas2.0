import type { Metadata } from "next";

import { INFO_VISTA, VISTAS_LOOK, normalizarMapa, resumenMapa, type VistaLook } from "@/lib/look";
import { BUCKET_LOOKS } from "@/lib/looks.server";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Tu look | Atlas Barber", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Compartido = {
  id: string;
  organization_id: string;
  empresa: string;
  cliente: string;
  barbero: string | null;
  fecha: string | null;
  propuesta: { nombre: string; por_que: string; mantencion_semanas: number; barba: string | null; mapa: unknown; vistas: Partial<Record<VistaLook, string>> };
};

const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

/**
 * El look aprobado, tal como lo ve el cliente desde WhatsApp. Sin cuenta: el
 * token largo es la llave, y deja de servir si la barbería lo revoca o el
 * cliente retira su autorización de fotos.
 */
export default async function LookCompartidoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let look: Compartido | null = null;
  let vistas: { vista: VistaLook; url: string }[] = [];
  if (/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
    const admin = createAdminClient();
    const { data } = await admin.rpc("look_compartido", { p_token: token });
    look = (data as Compartido | null) ?? null;
    if (look) {
      const rutas = VISTAS_LOOK.map((vista) => look?.propuesta.vistas?.[vista]).filter((ruta): ruta is string => Boolean(ruta));
      const { data: firmados } = rutas.length ? await admin.storage.from(BUCKET_LOOKS).createSignedUrls(rutas, 60 * 60 * 24) : { data: [] };
      const enlace = new Map((firmados ?? []).map((fila) => [fila.path, fila.signedUrl]));
      vistas = VISTAS_LOOK.flatMap((vista) => {
        const url = enlace.get(look?.propuesta.vistas?.[vista] ?? "");
        return url ? [{ vista, url }] : [];
      });
    }
  }

  if (!look) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f0eeeb] px-5 text-[#1c1a17]">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold">Este enlace ya no está disponible</h1>
          <p className="mt-2 text-sm text-[#6b635a]">Pídele a tu barbería que te lo envíe de nuevo.</p>
        </div>
      </main>
    );
  }

  const mapa = normalizarMapa(look.propuesta.mapa);
  return (
    <main className="min-h-screen bg-[#f0eeeb] px-4 py-8 text-[#1c1a17] sm:py-12">
      <article className="mx-auto w-full max-w-3xl">
        <header className="mb-6">
          <p className="text-sm font-medium text-[#8a5a1f]">{look.empresa}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{look.cliente}, este es tu look</h1>
          <p className="mt-2 text-base text-[#4a433b]">{look.propuesta.nombre}</p>
        </header>

        {vistas.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            {vistas.map(({ vista, url }) => (
              <figure key={vista} className="overflow-hidden rounded-2xl bg-white shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket, sin optimizador */}
                <img src={url} alt={`${look.propuesta.nombre}, vista ${INFO_VISTA[vista].nombre.toLowerCase()}`} className="aspect-[4/5] w-full object-cover" />
                <figcaption className="px-3 py-2 text-xs text-[#6b635a]">{INFO_VISTA[vista].nombre}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl bg-white p-5 text-sm text-[#6b635a] shadow-sm">Tu barbería guardó el corte sin fotos. Abajo está la ficha para pedirlo igual.</p>
        )}

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Por qué te queda bien</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#4a433b]">{look.propuesta.por_que}</p>
            <p className="mt-4 text-sm text-[#4a433b]">
              Mantención cada <strong>{look.propuesta.mantencion_semanas} semanas</strong>
              {look.barbero ? ` · con ${look.barbero}` : ""}
            </p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Para pedirlo igual</h2>
            <ul className="mt-2 space-y-1 text-sm text-[#4a433b]">
              {resumenMapa(mapa).map((linea) => (
                <li key={linea}>{linea}</li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="mt-8 text-center text-xs text-[#8b8177]">
          {look.fecha ? `Aprobado el ${fecha.format(new Date(`${look.fecha}T12:00:00Z`))}. ` : ""}Las imágenes son una simulación hecha con IA a partir de tu foto.
        </footer>
      </article>
    </main>
  );
}
