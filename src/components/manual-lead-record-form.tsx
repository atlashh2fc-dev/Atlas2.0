"use client";

import { useMemo, useRef, useState, useTransition, type InputHTMLAttributes } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Database, Loader2, Plus, Search } from "lucide-react";
import { createManualLeadRecord } from "@/app/actions/manual-records";
import { buscarRutEnBigdata, type RutLookupResult } from "@/app/actions/bigdata-lookup";
import {
  EMPTY_FICHA_FIELDS,
  REGIONES,
  fichaToFields,
  mergeFichaFields,
  type BigdataTelefono,
  type FichaFormFields,
} from "@/lib/bigdata-ficha";
import { toDateTimeInput } from "@/lib/report-range";
import { compactRut, isValidRut } from "@/lib/rut";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Option = {
  id: string;
  name: string;
};

type AgentOption = Option & {
  team_id: string | null;
};

type Lookup = Extract<RutLookupResult, { ok: true }>;

function FieldLabel({ children, fromBigdata }: { children: string; fromBigdata?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {children}
      {fromBigdata && (
        <span className="inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-primary">
          <Database size={10} />
          Bigdata
        </span>
      )}
    </span>
  );
}

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
  const [searching, startSearch] = useTransition();
  const [teamId, setTeamId] = useState(defaultTeamId ?? "");
  const [campaignId, setCampaignId] = useState(campaigns.length === 1 ? campaigns[0].id : "");
  const [assignedTo, setAssignedTo] = useState("");
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [rut, setRut] = useState("");
  const [rutError, setRutError] = useState<string | null>(null);
  // Campos y cuáles vinieron de Bigdata van juntos: la respuesta llega
  // mientras el supervisor sigue escribiendo y se funde sin pisarlo.
  const [draft, setDraft] = useState<{ fields: FichaFormFields; fromBigdata: Set<keyof FichaFormFields> }>({
    fields: EMPTY_FICHA_FIELDS,
    fromBigdata: new Set(),
  });
  const { fields, fromBigdata } = draft;
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const lookedUp = useRef<string | null>(null);

  const visibleAgents = useMemo(() => {
    if (role === "supervisor") return agents;
    if (!teamId) return agents;
    return agents.filter((agent) => agent.team_id === teamId);
  }, [agents, role, teamId]);

  const inCampaign = lookup?.enAtlas.find((lead) => campaignId && lead.campaignId === campaignId) ?? null;
  const elsewhere = (lookup?.enAtlas ?? []).filter((lead) => lead.campaignId !== campaignId);
  const ficha = lookup?.bigdata.estado === "encontrado" ? lookup.bigdata.ficha : null;
  // Números de Bigdata que no quedaron en el formulario, para elegir otro.
  const otherPhones: BigdataTelefono[] = (ficha?.telefonos ?? []).filter(
    (item) => item.telefono !== fields.phone && item.telefono !== fields.phone_alt
  );

  function setField(key: keyof FichaFormFields, value: string) {
    setDraft((current) => {
      // Lo que el supervisor toca deja de ser "de Bigdata".
      const next = new Set(current.fromBigdata);
      next.delete(key);
      return { fields: { ...current.fields, [key]: value }, fromBigdata: next };
    });
  }

  function searchRut(value: string, force = false) {
    if (!value.trim()) return;
    if (!isValidRut(value)) {
      setRutError("RUT inválido: revisa el dígito verificador.");
      return;
    }
    const key = compactRut(value);
    if (!force && lookedUp.current === key) return;
    lookedUp.current = key;
    startSearch(async () => {
      const result = await buscarRutEnBigdata(value);
      if (lookedUp.current !== key) return;
      if (!result.ok) {
        setRutError(result.message);
        return;
      }
      setRut(result.rut);
      setLookup(result);
      const proposed = result.bigdata.estado === "encontrado" ? fichaToFields(result.bigdata.ficha) : null;
      setDraft((current) => {
        // Lo que vino de otro RUT se retira; lo escrito a mano se queda.
        const base = { ...current.fields };
        for (const field of current.fromBigdata) base[field] = "";
        if (!proposed) return { fields: base, fromBigdata: new Set() };
        const merged = mergeFichaFields(base, proposed);
        return { fields: merged.fields, fromBigdata: new Set(merged.filled) };
      });
    });
  }

  function handleSubmit(formData: FormData) {
    setMessage(null);
    const field = (name: string) => String(formData.get(name) ?? "");
    if (!isValidRut(rut)) {
      setRutError("RUT inválido: revisa el dígito verificador.");
      return;
    }
    startTransition(async () => {
      const result = await createManualLeadRecord({
        fullName: fields.full_name,
        rut,
        phone: fields.phone,
        phoneAlt: fields.phone_alt,
        email: fields.email,
        teamId: field("team_id"),
        campaignId,
        assignedTo,
        notes: field("notes"),
        contactName: fields.contact_name,
        comuna: fields.comuna,
        region: fields.region,
        direccion: fields.direccion,
        rubro: fields.rubro,
        product: field("product"),
        completadoCon: fromBigdata.size > 0 ? "bigdata" : undefined,
        agendaAt: field("agenda_at"),
      });

      if (!result.ok) {
        setMessage({ type: "error", text: result.message ?? "No se pudo crear el registro." });
        return;
      }

      const agent = agents.find((item) => item.id === assignedTo);
      const agenda = result.agendaAt && agent
        ? ` Quedó en la agenda de ${agent.name} para el ${new Date(result.agendaAt).toLocaleString("es-CL", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "America/Santiago",
          })}.`
        : "";
      setMessage({
        type: "success",
        text: (result.duplicate
          ? "Ese RUT ya está en la base de la campaña. Abriremos su ficha."
          : "Registro ingresado fuera de base.") + agenda,
      });
      if (result.leadId) router.push(`/dashboard/leads/${result.leadId}`);
      else router.push("/dashboard/leads");
    });
  }

  const text = (key: keyof FichaFormFields, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="space-y-1.5">
      <FieldLabel fromBigdata={fromBigdata.has(key)}>{label}</FieldLabel>
      <input
        name={key}
        value={fields[key]}
        onChange={(event) => setField(key, event.target.value)}
        className={INPUT_CLASS}
        {...props}
      />
    </label>
  );

  return (
    // onSubmit y no action: con action React vacía el formulario al terminar,
    // y un RUT mal digitado obligaba a escribir todo de nuevo.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit(new FormData(event.currentTarget));
      }}
      className="space-y-5 rounded-xl border border-border bg-surface p-5"
    >
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
          <FieldLabel>Campaña *</FieldLabel>
          <select
            name="campaign_id"
            required
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
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
          <FieldLabel>RUT *</FieldLabel>
          <span className="flex gap-2">
            <input
              name="rut"
              required
              value={rut}
              placeholder="76.710.192-9"
              aria-invalid={rutError ? true : undefined}
              onBlur={(event) => searchRut(event.target.value)}
              onKeyDown={(event) => {
                // Enter busca; no envía un formulario a medio llenar.
                if (event.key === "Enter") {
                  event.preventDefault();
                  searchRut(event.currentTarget.value, true);
                }
              }}
              onChange={(event) => {
                setRut(event.target.value);
                if (rutError) setRutError(null);
              }}
              className={`${INPUT_CLASS} ${rutError ? "border-danger" : ""}`}
            />
            <button
              type="button"
              onClick={() => searchRut(rut, true)}
              disabled={searching || !rut.trim()}
              title="Buscar en Bigdata"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-60"
            >
              {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              Buscar
            </button>
          </span>
          {rutError && <span className="text-xs text-danger">{rutError}</span>}
        </label>
      </div>

      {(searching || lookup) && (
        <div className="space-y-2" aria-live="polite">
          {searching && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" />
              Buscando el RUT en Bigdata y en Atlas…
            </p>
          )}

          {!searching && inCampaign && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>
                Este RUT ya está en la base de {inCampaign.campaignName ?? "la campaña"}. Al ingresarlo se abre su ficha, no se
                duplica.{" "}
                <Link href={`/dashboard/leads/${inCampaign.leadId}`} className="font-medium underline">
                  Ver ficha
                </Link>
              </span>
            </div>
          )}

          {!searching && elsewhere.length > 0 && (
            <p className="text-sm text-muted-foreground">
              También está en:{" "}
              {elsewhere.map((lead, index) => (
                <span key={lead.leadId}>
                  {index > 0 && ", "}
                  <Link href={`/dashboard/leads/${lead.leadId}`} className="text-primary hover:underline">
                    {lead.campaignName ?? "sin campaña"}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}

          {!searching && lookup?.bigdata.estado === "encontrado" && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
              <Database size={15} />
              <span>
                {fromBigdata.size > 0
                  ? `Encontrado en Bigdata: completamos ${fromBigdata.size} ${fromBigdata.size === 1 ? "campo" : "campos"}. Revísalos y corrige lo que haga falta.`
                  : "Encontrado en Bigdata. Los campos ya tenían datos, no se cambió nada."}
              </span>
              {lookup.bigdata.ficha.clienteEquifax && (
                <span className="rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-foreground">Ya es cliente Equifax</span>
              )}
              {lookup.bigdata.ficha.activaSii === false && (
                <span className="rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-warning">Con término de giro en SII</span>
              )}
              {lookup.bigdata.ficha.noContactar && (
                <span className="rounded bg-surface px-1.5 py-0.5 text-xs font-medium text-danger">Marcado no contactar</span>
              )}
            </div>
          )}

          {!searching && lookup?.bigdata.estado === "no_encontrado" && (
            <p className="text-sm text-muted-foreground">Este RUT no está en Bigdata: completa los datos a mano.</p>
          )}

          {!searching && lookup?.bigdata.estado === "no_disponible" && (
            <p className="text-sm text-muted-foreground">
              No se pudo consultar Bigdata ({lookup.bigdata.motivo}) Puedes completar los datos a mano.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {text("full_name", "Nombre o razón social *", { required: true })}
        {text("contact_name", "Persona de contacto", { placeholder: "Con quién preguntar" })}
        {text("phone", "Teléfono", { type: "tel", placeholder: "+56 9 1234 5678" })}
        {text("phone_alt", "Teléfono adicional", { type: "tel", placeholder: "+56 2 2345 6789" })}

        {otherPhones.length > 0 && (
          <div className="space-y-1.5 lg:col-span-2">
            <FieldLabel>Otros números en Bigdata</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {otherPhones.slice(0, 6).map((item) => (
                <button
                  key={item.telefono}
                  type="button"
                  onClick={() => setField(fields.phone ? "phone_alt" : "phone", item.telefono)}
                  title={fields.phone ? "Usar como teléfono adicional" : "Usar como teléfono"}
                  className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-surface-muted"
                >
                  {item.telefono}
                  {item.nombre && <span className="text-muted-foreground"> · {item.nombre}</span>}
                  {item.esEmpresa && <span className="text-muted-foreground"> · empresa</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {text("email", "Email", { type: "email" })}

        <label className="space-y-1.5">
          <FieldLabel>Producto o plan</FieldLabel>
          <input name="product" className={INPUT_CLASS} />
        </label>

        <label className="space-y-1.5">
          <FieldLabel fromBigdata={fromBigdata.has("region")}>Región</FieldLabel>
          <select
            name="region"
            value={fields.region}
            onChange={(event) => setField("region", event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Sin región</option>
            {REGIONES.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>

        {text("comuna", "Comuna")}
        {text("direccion", "Dirección")}
        {text("rubro", "Rubro")}

        {(role === "admin" || teams.length > 1) && (
          <label className="space-y-1.5">
            <FieldLabel>Equipo</FieldLabel>
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
          <FieldLabel>Asignar a ejecutivo</FieldLabel>
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

        {assignedTo && (
          <label className="space-y-1.5">
            <FieldLabel>Agendar para</FieldLabel>
            <input
              type="datetime-local"
              name="agenda_at"
              min={toDateTimeInput(new Date())}
              className={INPUT_CLASS}
            />
            <span className="block text-xs text-muted-foreground">
              Hora Chile. Vacío = ahora: le aparece de inmediato en Mi agenda y, si está Disponible, el sistema se lo marca.
            </span>
          </label>
        )}
      </div>

      <label className="block space-y-1.5">
        <FieldLabel>Observación inicial</FieldLabel>
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
          disabled={pending || searching}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
        >
          <Plus size={16} />
          {pending ? "Ingresando..." : inCampaign ? "Abrir ficha existente" : "Ingresar registro"}
        </button>
      </div>
    </form>
  );
}
