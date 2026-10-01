"use client";

import { Scissors } from "lucide-react";

import { AtencionForm } from "@/components/atencion-form";
import { Avatar, Badge, SectionCard } from "@/components/ui";
import { pesos, resumenMateriales, totalAtencion, type Atencion, type Procedimiento } from "@/lib/arancel";

const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });

/**
 * Los servicios del cliente en la barbería: registrar lo que se hizo hoy (y
 * cobrarlo en la caja) y ver lo que se le ha hecho antes, con quién y cuánto.
 */
export function ServiciosBarber({
  cuentaId,
  nombre,
  arancel,
  atenciones,
  profesionales,
}: {
  cuentaId: string;
  nombre: string;
  arancel: Procedimiento[];
  atenciones: Atencion[];
  profesionales: string[];
}) {
  return (
    <SectionCard title="Servicios" description={`Lo que se le hizo a ${nombre}: con quién, cuándo y cuánto. Lo sin pagar aparece en la caja.`}>
      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <AtencionForm
          cuentaId={cuentaId}
          arancel={arancel}
          aplica={["cliente", "zona_cabeza"]}
          profesionales={profesionales}
          titulo={`Servicio de ${nombre}`}
          accion="Registrar servicio"
          icono={Scissors}
        />
        {atenciones.length === 0 ? (
          <p className="self-center text-sm text-muted-foreground">Todavía no hay servicios registrados. El primero queda acá y en la caja.</p>
        ) : (
          <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border">
            {atenciones.slice(0, 12).map((atencion) => {
              const [dia, mes, anio] = fecha.format(new Date(`${atencion.fecha}T12:00:00Z`)).replace(".", "").split(" ");
              return (
                <li key={atencion.id} className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-muted/50">
                  {/* La fecha en una baldosa de calendario: se ubica la visita de un vistazo. */}
                  <span className="flex w-11 flex-shrink-0 flex-col items-center rounded-lg border border-border bg-surface-raised py-1 leading-none" title={anio}>
                    <span className="text-[9px] font-semibold uppercase text-muted-foreground">{mes}</span>
                    <span className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{dia}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{atencion.descripcion}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      {atencion.profesional && <Avatar name={atencion.profesional} size="xs" />}
                      {[atencion.profesional, resumenMateriales(atencion.atencion_insumos), atencion.nota].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium tabular-nums text-foreground">{pesos.format(totalAtencion(atencion))}</p>
                    <Badge tone={atencion.pagado ? "success" : "warning"} className="mt-0.5">{atencion.pagado ? "Pagado" : "Por cobrar"}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
