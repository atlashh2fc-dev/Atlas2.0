import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";

import { TableroClinica } from "@/components/reporte-clinica/tablero";
import { Callout } from "@/components/ui";
import { fechaEnChile } from "@/lib/citas";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { formatReportRangeLabel, resolveReportRange, toDateInput } from "@/lib/report-range";
import { inicioDeLosHechos } from "@/lib/reporte-clinica";
import { createClient } from "@/lib/supabase/server";

/**
 * Reportes de la clínica (Dental y Vet).
 *
 * El servidor resuelve el período de la URL y trae, en una sola consulta, los
 * hechos de ese período, del anterior de igual largo y del mismo tramo un año
 * antes, para que la comparación se elija en el navegador sin recargar. Todo el cruce de
 * filtros ocurre en el navegador (ver `TableroClinica`).
 */
export default async function ReportesClinicaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  noStore();
  const { edicion, empresa } = await contextoDeMiEmpresa();
  if (edicion !== "dental" && edicion !== "vet") notFound();

  const parametros = await searchParams;
  const rango = resolveReportRange({ preset: parametros.preset, from: parametros.from, to: parametros.to });
  const periodo = { desde: toDateInput(rango.from), hasta: toDateInput(rango.to) };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reporte_clinica", { p_desde: inicioDeLosHechos(periodo), p_hasta: periodo.hasta });

  const filtros: Record<string, string | undefined> = {};
  for (const [clave, valor] of Object.entries(parametros)) if (clave.startsWith("f_")) filtros[clave] = valor;

  return (
    <div className="space-y-3">
      {rango.notice && <Callout tone="warning">{rango.notice}</Callout>}
      {error ? (
        <Callout tone="danger">No se pudieron leer los reportes de la clínica. Vuelve a cargar para reintentar.</Callout>
      ) : (
        <TableroClinica
          key={`${periodo.desde}:${periodo.hasta}`}
          raw={data}
          periodo={periodo}
          hoy={fechaEnChile(new Date())}
          edicion={edicion}
          empresa={empresa}
          etiquetaPeriodo={formatReportRangeLabel(rango)}
          filtrosIniciales={filtros}
          vistaInicial={parametros.vista}
        />
      )}
    </div>
  );
}
