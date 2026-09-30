"use client";

import { Scissors } from "lucide-react";

import { AtencionForm } from "@/components/atencion-form";
import { SectionCard } from "@/components/ui";
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
    <SectionCard icon={Scissors} tone="amber" title="Servicios" description={`Lo que se le hizo a ${nombre}: con quién, cuándo y cuánto. Lo sin pagar aparece en la caja.`}>
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
          <ul className="divide-y divide-border rounded-xl border border-border">
            {atenciones.slice(0, 12).map((atencion) => (
              <li key={atencion.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-24 flex-shrink-0 text-xs text-muted-foreground">{fecha.format(new Date(`${atencion.fecha}T12:00:00Z`))}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{atencion.descripcion}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[atencion.profesional, resumenMateriales(atencion.atencion_insumos), atencion.nota].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm tabular-nums text-foreground">{pesos.format(totalAtencion(atencion))}</p>
                  <p className={`text-[11px] ${atencion.pagado ? "text-success" : "text-warning"}`}>{atencion.pagado ? "Pagado" : "Por cobrar"}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
