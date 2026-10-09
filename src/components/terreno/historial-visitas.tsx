import Link from "next/link";
import { MapPin, MapPinOff } from "lucide-react";

import { Badge } from "@/components/ui";
import { ETAPA_INFO, MOTIVO_LABEL, mapaHref, type VisitaTerreno } from "@/lib/terreno";

const fecha = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Visitas del cliente, la más reciente arriba, con su foto y su ubicación. */
export function HistorialVisitas({
  visitas,
  fotos,
  mostrarVendedor,
  sinTitulo,
}: {
  visitas: (VisitaTerreno & { vendedor?: string | null; cliente?: string | null })[];
  fotos: Record<string, string>;
  mostrarVendedor?: boolean;
  /** Dentro de una sección que ya tiene su propio título. */
  sinTitulo?: boolean;
}) {
  return (
    <section className="space-y-3">
      {!sinTitulo && (
        <h2 className="text-base font-semibold">
          Visitas <span className="font-normal text-muted-foreground">({visitas.length})</span>
        </h2>
      )}
      {visitas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          Todavía no hay visitas. La primera se registra desde el local, con foto y ubicación.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {visitas.map((visita) => {
            const info = ETAPA_INFO[visita.etapa];
            const foto = visita.foto_path ? fotos[visita.foto_path] : null;
            const mapa = mapaHref({ lat: visita.lat, lng: visita.lng });
            return (
              <li key={visita.id} className="flex gap-3 rounded-xl border border-border bg-surface p-3">
                {foto ? (
                  <a href={foto} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada y temporal de Storage */}
                    <img src={foto} alt="Foto de la visita" className="size-16 rounded-lg object-cover" loading="lazy" />
                  </a>
                ) : (
                  <div className="size-16 shrink-0 rounded-lg bg-surface-muted" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  {visita.cliente && (
                    <Link href={`/dashboard/leads/${visita.lead_id}`} className="block truncate text-sm font-semibold hover:underline">
                      {visita.cliente}
                    </Link>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={info.tone}>{info.label}</Badge>
                    {visita.etapa === "descartado" && visita.motivo_salida && (
                      <span className="text-xs text-muted-foreground">{MOTIVO_LABEL[visita.motivo_salida]}</span>
                    )}
                    {visita.etapa === "vendido" && visita.pos_cantidad && (
                      <span className="text-xs text-muted-foreground">
                        {visita.pos_cantidad} × {visita.pos_modelo ?? "lector"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {fecha.format(new Date(visita.created_at))}
                    {mostrarVendedor && visita.vendedor ? ` · ${visita.vendedor}` : ""}
                  </p>
                  {visita.nota && <p className="text-sm [overflow-wrap:anywhere]">{visita.nota}</p>}
                  {mapa ? (
                    <a href={mapa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <MapPin size={13} aria-hidden="true" />
                      Ver ubicación{visita.precision_m ? ` (±${visita.precision_m} m)` : ""}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-warning">
                      <MapPinOff size={13} aria-hidden="true" />
                      Sin ubicación: {visita.sin_ubicacion}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
