import Link from "next/link";
import { CalendarDays, Camera, CreditCard, Footprints, LocateFixed, Store, TrendingUp } from "lucide-react";

import { EmbudoBarras, porcentaje, sumarEmbudo } from "@/components/terreno/embudo-barras";
import { HistorialVisitas } from "@/components/terreno/historial-visitas";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { Callout, SectionCard, Table, TableEmpty, Tbody, Td, Th, Thead, Tr } from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { formatReportRangeLabel, resolveReportRange } from "@/lib/report-range";
import { createClient } from "@/lib/supabase/server";
import type { EmbudoVendedor, VisitaTerreno } from "@/lib/terreno";
import { firmarFotosTerreno, misCampanasTerreno } from "@/lib/terreno.server";
import { cn } from "@/lib/utils";

const fechaCorta = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Productividad y gestión de los vendedores en terreno: cuánto salen
 * (visitas y días activos), cuánto avanza su cartera (embudo) y cuánto venden.
 * La calidad del registro (GPS y foto) va al lado de la productividad: una
 * visita sin ubicación no se puede verificar.
 */
export default async function ReportesTerrenoPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string; preset?: string; from?: string; to?: string }>;
}) {
  await requireProfile(["admin", "supervisor"]);
  const { campaign, preset, from, to } = await searchParams;
  const range = resolveReportRange({ preset, from, to });
  const campanas = await misCampanasTerreno();

  if (campanas.length === 0) {
    return (
      <Callout tone="info">
        No hay campañas de terreno activas. Una campaña de terreno es la que trabajan vendedores en la calle desde
        el celular (por ejemplo, Mercado Pago).
      </Callout>
    );
  }

  const actual = campanas.find((item) => item.id === campaign) ?? campanas[0];
  const supabase = await createClient();
  const [{ data: embudoData, error }, { data: visitasData }] = await Promise.all([
    supabase.rpc("terreno_embudo", {
      p_campaign_id: actual.id,
      p_desde: range.from.toISOString(),
      p_hasta: range.to.toISOString(),
    }),
    supabase
      .from("terreno_visitas")
      .select(
        "id, lead_id, vendedor_id, etapa_antes, etapa, motivo_salida, nota, lat, lng, precision_m, sin_ubicacion, foto_path, pos_cantidad, pos_modelo, created_at, lead:leads(full_name)",
      )
      .eq("campaign_id", actual.id)
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString())
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const filas = (embudoData ?? []) as EmbudoVendedor[];
  const t = sumarEmbudo(filas);
  const visitas = ((visitasData ?? []) as unknown as (VisitaTerreno & { lead: { full_name: string } | { full_name: string }[] | null })[]).map(
    ({ lead, ...visita }) => ({ ...visita, cliente: (Array.isArray(lead) ? lead[0] : lead)?.full_name ?? null }),
  );
  const fotos = await firmarFotosTerreno(visitas.map((visita) => visita.foto_path));
  const nombres = new Map(filas.map((fila) => [fila.vendedor_id, fila.vendedor]));
  const gpsPct = t.visitas > 0 ? (t.visitas_con_gps / t.visitas) * 100 : 0;

  return (
    <div className="space-y-6">
      {campanas.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Campaña">
          {campanas.map((item) => (
            <Link
              key={item.id}
              href={`?campaign=${item.id}${preset ? `&preset=${preset}` : ""}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`}
              aria-current={item.id === actual.id ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                item.id === actual.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface",
              )}
            >
              {item.name}
            </Link>
          ))}
        </nav>
      )}

      {error && <Callout tone="danger">No se pudo calcular el reporte: {error.message}</Callout>}

      <KpiStrip title={`Terreno · ${actual.name}`} meta={formatReportRangeLabel(range)} columns={5}>
        <KpiStripItem label="Visitas" value={t.visitas.toLocaleString("es-CL")} icon={Footprints} />
        <KpiStripItem label="Clientes ingresados" value={t.clientes.toLocaleString("es-CL")} icon={Store} />
        <KpiStripItem
          label="Ventas"
          value={t.ventas.toLocaleString("es-CL")}
          icon={CreditCard}
          detail={`${t.lectores.toLocaleString("es-CL")} lectores`}
          tone={t.ventas > 0 ? "good" : "default"}
        />
        <KpiStripItem
          label="Conversión"
          value={porcentaje(t.vendidos, t.clientes)}
          icon={TrendingUp}
          definition={{ text: "De los clientes ingresados en el período, cuántos ya compraron.", formula: "vendidos ÷ ingresados" }}
        />
        <KpiStripItem
          label="Visitas con GPS"
          value={t.visitas > 0 ? `${Math.round(gpsPct)}%` : "—"}
          icon={LocateFixed}
          progress={gpsPct}
          tone={t.visitas > 0 && gpsPct < 80 ? "warn" : "default"}
          detail="Verificables en el mapa"
        />
      </KpiStrip>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <SectionCard title="Embudo" description="Clientes ingresados en el período y la etapa más alta a la que llegaron.">
          {t.clientes === 0 ? (
            <p className="text-sm text-muted-foreground">Sin clientes ingresados en el período.</p>
          ) : (
            <EmbudoBarras totales={t} />
          )}
        </SectionCard>

        <SectionCard title="Por vendedor" description="Ordenado por ventas y luego por visitas.">
          <div className="-mx-5 overflow-x-auto">
            <Table>
              <Thead>
                <Th>Vendedor</Th>
                <Th align="right">Días</Th>
                <Th align="right">Visitas</Th>
                <Th align="right">Por día</Th>
                <Th align="right">Ingresados</Th>
                <Th align="right">Interesados</Th>
                <Th align="right">Ventas</Th>
                <Th align="right">Lectores</Th>
                <Th align="right">Conv.</Th>
                <Th align="right">GPS</Th>
                <Th align="right">Última visita</Th>
              </Thead>
              <Tbody>
                {filas.length === 0 ? (
                  <TableEmpty colSpan={11}>
                    No hay vendedores en esta campaña. Agrégalos en Campañas → {actual.name} → Ejecutivos.
                  </TableEmpty>
                ) : (
                  filas.map((fila) => (
                    <Tr key={fila.vendedor_id}>
                      <Td className="font-medium">{fila.vendedor}</Td>
                      <Td align="right">{fila.dias_activos}</Td>
                      <Td align="right">{fila.visitas}</Td>
                      <Td align="right">{fila.dias_activos > 0 ? (fila.visitas / fila.dias_activos).toFixed(1) : "—"}</Td>
                      <Td align="right">{fila.clientes}</Td>
                      <Td align="right">{fila.interesados}</Td>
                      <Td align="right" className="font-semibold">{fila.ventas}</Td>
                      <Td align="right">{fila.lectores}</Td>
                      <Td align="right">{porcentaje(fila.vendidos, fila.clientes)}</Td>
                      <Td align="right" className={cn(fila.visitas > 0 && fila.visitas_con_gps / fila.visitas < 0.8 && "text-warning")}>
                        {fila.visitas > 0 ? porcentaje(fila.visitas_con_gps, fila.visitas) : "—"}
                      </Td>
                      <Td align="right" className="whitespace-nowrap text-muted-foreground">
                        {fila.ultima_visita_at ? fechaCorta.format(new Date(fila.ultima_visita_at)) : "—"}
                      </Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </Table>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Últimas visitas"
        description="Las 30 más recientes del período, con foto y ubicación para verificarlas."
        actions={
          <span className="inline-flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Camera size={13} aria-hidden="true" /> {t.visitas_con_foto} con foto
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={13} aria-hidden="true" /> {formatReportRangeLabel(range)}
            </span>
          </span>
        }
      >
        <HistorialVisitas
          visitas={visitas.map((visita) => ({ ...visita, vendedor: nombres.get(visita.vendedor_id) ?? null }))}
          fotos={Object.fromEntries(fotos)}
          mostrarVendedor
        />
      </SectionCard>
    </div>
  );
}
