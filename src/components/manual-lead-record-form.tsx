"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Plus } from "lucide-react";
import { createManualLeadRecord } from "@/app/actions/manual-records";

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

  const visibleAgents = useMemo(() => {
    if (role === "supervisor") return agents;
    if (!teamId) return agents;
    return agents.filter((agent) => agent.team_id === teamId);
  }, [agents, role, teamId]);

  function handleSubmit(formData: FormData) {
    setMessage(null);
    startTransition(async () => {
      const result = await createManualLeadRecord({
        fullName: String(formData.get("full_name") ?? ""),
        rut: String(formData.get("rut") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        email: String(formData.get("email") ?? ""),
        teamId: String(formData.get("team_id") ?? ""),
        campaignId: String(formData.get("campaign_id") ?? ""),
        assignedTo: String(formData.get("assigned_to") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });

      if (!result.ok) {
        setMessage({ type: "error", text: result.message ?? "No se pudo crear el registro." });
        return;
      }

      setMessage({ type: "success", text: "Registro creado correctamente." });
      if (result.leadId) router.push(`/dashboard/leads/${result.leadId}`);
      else router.push("/dashboard/leads");
    });
  }

  return (
    <form action={handleSubmit} className="space-y-5 rounded-xl border border-border bg-surface p-5">
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
          <span className="text-xs font-medium text-muted-foreground">Nombre o razón social</span>
          <input
            name="full_name"
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">RUT</span>
          <input
            name="rut"
            placeholder="76.710.192-9"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Teléfono</span>
          <input
            name="phone"
            placeholder="+569..."
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Email</span>
          <input
            type="email"
            name="email"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        {role === "admin" && (
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Equipo</span>
            <select
              name="team_id"
              value={teamId}
              onChange={(event) => {
                setTeamId(event.target.value);
                setAssignedTo("");
              }}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <span className="text-xs font-medium text-muted-foreground">Campaña</span>
          <select
            name="campaign_id"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Sin campaña</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Asignar a ejecutivo</span>
          <select
            name="assigned_to"
            value={assignedTo}
            onChange={(event) => setAssignedTo(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Crear sin asignar</option>
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
        <textarea
          name="notes"
          rows={3}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
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
          {pending ? "Creando..." : "Crear registro"}
        </button>
      </div>
    </form>
  );
}
