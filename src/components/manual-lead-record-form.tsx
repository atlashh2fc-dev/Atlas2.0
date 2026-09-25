"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Plus } from "lucide-react";
import { createManualLeadRecord } from "@/app/actions/manual-records";
import { isValidRut } from "@/lib/rut";

const REGIONES = [
  "Arica y Parinacota",
  "Tarapacá",
  "Antofagasta",
  "Atacama",
  "Coquimbo",
  "Valparaíso",
  "Metropolitana de Santiago",
  "Libertador General Bernardo O'Higgins",
  "Maule",
  "Ñuble",
  "Biobío",
  "La Araucanía",
  "Los Ríos",
  "Los Lagos",
  "Aysén del General Carlos Ibáñez del Campo",
  "Magallanes y de la Antártica Chilena",
];

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Option = {
  id: string;
  name: string;
};

type AgentOption = Option & {
  team_id: string | null;
};

export function ManualLeadRecordForm({
  role,
  teams,
  agents,
  campaigns,
  defaultTeamId,
}: {
  role: "supervisor" | "admin";
  teams: Option[];
  agents: AgentOption[];
  campaigns: Option[];
  defaultTeamId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [teamId, setTeamId] = useState(defaultTeamId ?? "");
  const [assignedTo, setAssignedTo] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [rutError, setRutError] = useState<string | null>(null);

  const visibleAgents = useMemo(() => {
    if (role === "supervisor") return agents;
    if (!teamId) return agents;
    return agents.filter((agent) => agent.team_id === teamId);
  }, [agents, role, teamId]);

  function checkRut(value: string) {
    setRutError(value.trim() && !isValidRut(value) ? "RUT inválido: revisa el dígito verificador." : null);
  }

  function handleSubmit(formData: FormData) {
    setMessage(null);
    const field = (name: string) => String(formData.get(name) ?? "");
    if (!isValidRut(field("rut"))) {
      setRutError("RUT inválido: revisa el dígito verificador.");
      return;
    }
    startTransition(async () => {
      const result = await createManualLeadRecord({
        fullName: field("full_name"),
        rut: field("rut"),
        phone: field("phone"),
        phoneAlt: field("phone_alt"),
        email: field("email"),
        teamId: field("team_id"),
        campaignId: field("campaign_id"),
        assignedTo: field("assigned_to"),
        notes: field("notes"),
        contactName: field("contact_name"),
        comuna: field("comuna"),
        region: field("region"),
        product: field("product"),
      });

      if (!result.ok) {
        setMessage({ type: "error", text: result.message ?? "No se pudo crear el registro." });
        return;
      }

      setMessage({
        type: "success",
        text: result.duplicate
          ? "Ese RUT ya está en la base de la campaña. Abriremos su ficha."
          : "Registro ingresado fuera de base.",
      });
      if (result.leadId) router.push(`/dashboard/leads/${result.leadId}`);
      else router.push("/dashboard/leads");
    });
  }

  return (
    // onSubmit y no action: con action React vacía el formulario al terminar,
    // y un RUT mal digitado obligaba a escribir todo de nuevo.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit(new FormData(event.currentTarget));
      }}
      className="space-y-5 rounded-xl border border-border bg-surface p-5">
      {message && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
            message.type === "error"
              ? "border-danger/30 bg-danger-bg text-danger"
              : "border-success/30 bg-success/10 text-success"
          }`}
        >
          {message.type === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Campaña *</span>
          <select
            name="campaign_id"
            required
            defaultValue={campaigns.length === 1 ? campaigns[0].id : ""}
            className={INPUT_CLASS}
          >
            <option value="" disabled>
              Seleccionar campaña
            </option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">RUT *</span>
          <input
            name="rut"
            required
            placeholder="76.710.192-9"
            aria-invalid={rutError ? true : undefined}
            onBlur={(event) => checkRut(event.target.value)}
            onChange={() => rutError && setRutError(null)}
            className={`${INPUT_CLASS} ${rutError ? "border-danger" : ""}`}
          />
          {rutError && <span className="text-xs text-danger">{rutError}</span>}
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Nombre o razón social *</span>
          <input name="full_name" required className={INPUT_CLASS} />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Persona de contacto</span>
          <input name="contact_name" placeholder="Con quién preguntar" className={INPUT_CLASS} />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Teléfono</span>
          <input name="phone" type="tel" placeholder="+56 9 1234 5678" className={INPUT_CLASS} />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Teléfono adicional</span>
          <input name="phone_alt" type="tel" placeholder="+56 2 2345 6789" className={INPUT_CLASS} />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Email</span>
          <input type="email" name="email" className={INPUT_CLASS} />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Producto o plan</span>
          <input name="product" className={INPUT_CLASS} />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Región</span>
          <select name="region" defaultValue="" className={INPUT_CLASS}>
            <option value="">Sin región</option>
            {REGIONES.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Comuna</span>
          <input name="comuna" className={INPUT_CLASS} />
        </label>

        {(role === "admin" || teams.length > 1) && (
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Equipo</span>
            <select
              name="team_id"
              value={teamId}
              onChange={(event) => {
                setTeamId(event.target.value);
                setAssignedTo("");
              }}
              className={INPUT_CLASS}
            >
              <option value="">Seleccionar equipo</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Asignar a ejecutivo</span>
          <select
            name="assigned_to"
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Sin asignar: queda en la base de la campaña</option>
            {visibleAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Observación inicial</span>
        <textarea name="notes" rows={3} className={INPUT_CLASS} />
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.push("/dashboard/leads")}
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
        >
          <Plus size={16} />
          {pending ? "Ingresando..." : "Ingresar registro"}
        </button>
      </div>
    </form>
  );
}
