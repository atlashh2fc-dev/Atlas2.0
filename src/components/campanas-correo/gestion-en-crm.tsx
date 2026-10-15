"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Link2, Loader2 } from "lucide-react";

import { conectarCampanaCorreoAlCrm } from "@/app/actions/campanas-correo";
import { Button, Field, Select, useToast } from "@/components/ui";
import type { OpcionesDeVinculo, VinculoCorreoCrm } from "@/lib/vinculo-correo-crm.server";

/**
 * Dónde se gestionan en el CRM quienes abren, hacen clic o responden. Sin
 * vínculo Atlas Lead no exporta nada y la campaña no aparece en Correo.
 */
export function GestionEnCrm({
  campanaId,
  vinculo,
  opciones,
  borrador,
}: {
  campanaId: string;
  vinculo: VinculoCorreoCrm | null;
  opciones: OpcionesDeVinculo;
  borrador: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [conectando, start] = useTransition();
  const inicial = opciones.sugerencia ?? (opciones.campanas[0] ? { campaignId: opciones.campanas[0].id, teamId: opciones.campanas[0].equipos[0]?.id ?? "" } : null);
  const [campaignId, setCampaignId] = useState(inicial?.campaignId ?? "");
  const [teamId, setTeamId] = useState(inicial?.teamId ?? "");
  const equipos = opciones.campanas.find((item) => item.id === campaignId)?.equipos ?? [];

  if (vinculo) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-foreground">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          <span>
            Quienes abren, hacen clic o responden llegan a <strong>{vinculo.campaignName}</strong>
            {vinculo.equipo ? <> · equipo {vinculo.equipo}</> : null}.
          </span>
        </p>
        <Link href={`/dashboard/mail?mailCampaign=${vinculo.mailCampaignId}`} className="inline-flex min-h-8 items-center text-sm text-primary hover:underline">
          Ver y asignar en Correo
        </Link>
      </div>
    );
  }

  if (!opciones.campanas.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta empresa no tiene campañas del CRM con ejecutivos habilitados. Crea una en Administración → Campañas y habilita a su equipo para poder conectarla.
      </p>
    );
  }

  function conectar() {
    start(async () => {
      const resultado = await conectarCampanaCorreoAlCrm({ campanaId, campaignId, teamId });
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      toast({ tone: "success", message: "Conectada: las aperturas y respuestas ya llegan a Correo" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        {borrador
          ? "Al lanzarla, quienes abran, hagan clic o respondan quedan en esta campaña del CRM para asignarlos."
          : "Todavía no está conectada: sus aperturas y respuestas no llegan a Correo. Al conectarla se trae también lo que ya pasó."}
      </p>
      <Field label="Campaña del CRM">
        <Select
          value={campaignId}
          onChange={(evento) => {
            setCampaignId(evento.target.value);
            setTeamId(opciones.campanas.find((item) => item.id === evento.target.value)?.equipos[0]?.id ?? "");
          }}
        >
          {opciones.campanas.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nombre}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Equipo que la atiende">
        <Select value={teamId} onChange={(evento) => setTeamId(evento.target.value)}>
          {equipos.map((equipo) => (
            <option key={equipo.id} value={equipo.id}>
              {equipo.nombre}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="button" variant={borrador ? "secondary" : "primary"} onClick={conectar} disabled={conectando || !campaignId || !teamId}>
        {conectando ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
        {conectando ? "Conectando…" : "Conectar al CRM"}
      </Button>
    </div>
  );
}
