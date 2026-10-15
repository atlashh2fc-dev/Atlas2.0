import Link from "next/link";
import type { ComponentType } from "react";
import { Mail, MessageCircle, Network, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { SectionCard } from "@/components/ui";
import type { CampaignChannelFunnelRow } from "@/lib/types";
import {
  channelSegmentHref,
  channelSlug,
  type ChannelSlug,
  type ChannelStage,
} from "@/lib/channel-segment";

/**
 * KPI por canal de una campaña y sus hijas.
 *
 * Es la vista que tienen Salesforce (jerarquía de campañas) y HubSpot (una
 * campaña, el canal como dimensión): la iniciativa se mira entera arriba y acá
 * se abre por dónde entró cada contacto. Cada registro cuenta en un solo
 * canal, así que la fila Total es la suma y una venta no se cuenta dos veces.
 */

type Range = { from: string; to: string };

const CHANNEL_ICON: Record<CampaignChannelFunnelRow["channel"], ComponentType<{ size?: number; className?: string }>> = {
  "Llamada saliente": PhoneOutgoing,
  "Llamada entrante": PhoneIncoming,
  WhatsApp: MessageCircle,
  Correo: Mail,
};

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("es-CL");
}

/** Contactados sobre gestionados: las dos cifras son del mismo período. */
function contactRate(row: { managed: number; contacted: number }): string {
  if (row.managed <= 0) return "–";
  return `${((row.contacted / row.managed) * 100).toLocaleString("es-CL", { maximumFractionDigits: 1 })} %`;
}

/**
 * Cada número abre Registros con exactamente los leads que cuenta. Un cero no
 * lleva a ninguna parte: sería abrir una lista vacía.
 */
function Cell({
  value,
  campaignId,
  channel,
  stage,
  range,
  className,
}: {
  value: number;
  campaignId: string;
  channel: ChannelSlug | null;
  stage: ChannelStage;
  range: Range;
  className: string;
}) {
  if (value <= 0) return <td className={className}>{fmtInt(value)}</td>;
  return (
    <td className={className}>
      <Link
        href={channelSegmentHref({ campaignId, channel, stage, from: range.from, to: range.to })}
        className="rounded underline-offset-2 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        title="Ver estos registros"
      >
        {fmtInt(value)}
      </Link>
    </td>
  );
}

export function CampaignChannelTable({
  rows,
  range,
  campaignId,
}: {
  rows: CampaignChannelFunnelRow[];
  range: Range;
  campaignId: string;
}) {
  if (rows.length === 0) return null;

  const totals = rows.reduce(
    (sum, row) => ({
      base: sum.base + row.base,
      managed: sum.managed + row.managed,
      contacted: sum.contacted + row.contacted,
      interested: sum.interested + row.interested,
      sales: sum.sales + row.sales,
    }),
    { base: 0, managed: 0, contacted: 0, interested: 0, sales: 0 }
  );
  const rowCell = "py-2.5 text-right tabular-nums text-muted-foreground";
  const totalCell = "pt-2.5 text-right tabular-nums";

  return (
    <SectionCard
      title="Resultado por canal"
      icon={Network}
      tone="teal"
      description={
        <>
          Cada registro cuenta en el canal por el que entró, así que el total es la suma y una venta no se cuenta dos
          veces. Toca un número para ver esos registros.
        </>
      }
    >
      <div className="overflow-x-auto px-5 pt-2">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="h-10 font-medium">Canal</th>
              <th className="py-2 text-right font-semibold">Base</th>
              <th className="py-2 text-right font-semibold">Gestionados</th>
              <th className="py-2 text-right font-semibold">Contactados</th>
              <th className="py-2 text-right font-semibold">% contacto</th>
              <th className="py-2 text-right font-semibold">Interesados</th>
              <th className="py-2 text-right font-semibold">Ventas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const channel = channelSlug(row.channel);
              const Icon = CHANNEL_ICON[row.channel] ?? Network;
              const idle = row.base === 0 && row.managed === 0;
              return (
                <tr key={row.channel} className={idle ? "opacity-60" : undefined}>
                  <td className="py-2.5 font-medium text-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Icon size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                      {row.channel}
                    </span>
                    {idle && <span className="block pl-[23px] text-xs font-normal text-muted-foreground">Sin registros todavía</span>}
                  </td>
                  <Cell value={row.base} campaignId={campaignId} channel={channel} stage="base" range={range} className={rowCell} />
                  <Cell value={row.managed} campaignId={campaignId} channel={channel} stage="gestionados" range={range} className={rowCell} />
                  <Cell value={row.contacted} campaignId={campaignId} channel={channel} stage="contactados" range={range} className={rowCell} />
                  <td className={rowCell}>{contactRate(row)}</td>
                  <Cell value={row.interested} campaignId={campaignId} channel={channel} stage="interesados" range={range} className={rowCell} />
                  <Cell
                    value={row.sales}
                    campaignId={campaignId}
                    channel={channel}
                    stage="ventas"
                    range={range}
                    className="py-2.5 text-right font-semibold tabular-nums text-success"
                  />
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-border font-semibold text-foreground">
            <tr>
              <td className="pt-2.5">Total</td>
              <Cell value={totals.base} campaignId={campaignId} channel={null} stage="base" range={range} className={totalCell} />
              <Cell value={totals.managed} campaignId={campaignId} channel={null} stage="gestionados" range={range} className={totalCell} />
              <Cell value={totals.contacted} campaignId={campaignId} channel={null} stage="contactados" range={range} className={totalCell} />
              <td className={totalCell}>{contactRate(totals)}</td>
              <Cell value={totals.interested} campaignId={campaignId} channel={null} stage="interesados" range={range} className={totalCell} />
              <Cell value={totals.sales} campaignId={campaignId} channel={null} stage="ventas" range={range} className={totalCell} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-5 pb-5 pt-4 text-xs text-muted-foreground">
        Base: registros que entraron por el canal. Gestionado: tuvo una gestión o un mensaje en el período. Contactado:
        conversación efectiva o respuesta por WhatsApp. Interesado: seguimiento, derivación o agenda. Venta: venta en
        validación registrada, por cualquier canal.
      </p>
    </SectionCard>
  );
}
