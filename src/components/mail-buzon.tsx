"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ChevronRight, Clock3, Inbox, Mail, MessageCircleReply, UserRound, UserX, XCircle } from "lucide-react";

import { gestionarCorreoDeBuzon } from "@/app/actions/correo-registro";
import { Badge, Button, EmptyState, Input, SectionCard, Select, SlideOver } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { sinCita } from "@/lib/correo/sin-cita";

/**
 * Correo › Buzón. La cola del buzón de la cuenta (el de las cotizaciones y las
 * respuestas del ejecutivo, no el de campañas masivas), tratada como tickets:
 * qué llegó, de qué registro, a quién quedó, si ya se respondió y cuánto lleva
 * esperando. Supervisión asigna, liga por RUT lo que llegó de una dirección
 * desconocida o cierra lo que no es de un cliente.
 */

export type BuzonRow = {
  id: string;
  mailbox: string;
  from_name: string | null;
  from_address: string;
  subject: string;
  body_text: string;
  received_at: string;
  status: "new" | "converted";
  asignacion: "agenda" | "cotizacion" | "propietario" | "supervision" | "cola" | "reasignado" | null;
  lead_id: string | null;
  lead_name: string | null;
  lead_rut: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  respuesta: { agente: string; created_at: string; estado: "enviando" | "enviado" | "fallido" } | null;
};

export type BuzonAgent = { id: string; full_name: string; email: string };

type Estado = "sin_asignar" | "pendiente" | "respondido" | "cerrado";

const ESTADO: Record<Estado, { label: string; tone: "danger" | "warning" | "success" | "neutral"; icon: typeof Inbox }> = {
  sin_asignar: { label: "Sin asignar", tone: "danger", icon: UserX },
  pendiente: { label: "Pendiente del ejecutivo", tone: "warning", icon: MessageCircleReply },
  respondido: { label: "Respondido", tone: "success", icon: CheckCheck },
  cerrado: { label: "Cerrado sin correo", tone: "neutral", icon: XCircle },
};

const MOTIVO: Record<NonNullable<BuzonRow["asignacion"]>, string> = {
  agenda: "tiene la agenda",
  cotizacion: "envió la propuesta",
  propietario: "ejecutivo del registro",
  supervision: "asignado por supervisión",
  cola: "repartido por la cola",
  reasignado: "reasignado: el anterior no estaba",
};

function estadoDe(row: BuzonRow): Estado {
  if (row.respuesta && row.respuesta.estado !== "fallido") return "respondido";
  if (row.status === "converted") return "cerrado";
  return row.assigned_to ? "pendiente" : "sin_asignar";
}

const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function duracion(desde: string, hasta: number): string {
  const minutos = Math.max(0, Math.round((hasta - new Date(desde).getTime()) / 60_000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h ${minutos % 60 ? `${minutos % 60} min` : ""}`.trim();
  return `${Math.floor(horas / 24)} d ${horas % 24} h`;
}

/** Borde y cifra de cada estado, igual que las baldosas de la cola de campañas. */
function tonoBaldosa(tone: "danger" | "warning" | "success" | "neutral" | "info") {
  return tone === "danger"
    ? { edge: "border-l-danger", value: "text-danger" }
    : tone === "warning"
      ? { edge: "border-l-warning", value: "text-warning" }
      : tone === "success"
        ? { edge: "border-l-success", value: "text-success" }
        : tone === "info"
          ? { edge: "border-l-primary", value: "text-primary" }
          : { edge: "border-l-border-strong", value: "text-foreground" };
}

export function MailBuzon({ rows, agents, ahora }: { rows: BuzonRow[]; agents: BuzonAgent[]; ahora: number }) {
  const [filtro, setFiltro] = useState<Estado | "todos" | "abiertos">("abiertos");
  const [abierto, setAbierto] = useState<BuzonRow | null>(null);

  const conEstado = useMemo(() => rows.map((row) => ({ row, estado: estadoDe(row) })), [rows]);
  const conteo = (estado: Estado) => conEstado.filter((item) => item.estado === estado).length;
  const abiertos = conteo("sin_asignar") + conteo("pendiente");
  const visibles = conEstado.filter((item) =>
    filtro === "todos" ? true : filtro === "abiertos" ? item.estado === "sin_asignar" || item.estado === "pendiente" : item.estado === filtro,
  );
  // Los abiertos, del que más espera al que menos; el resto, lo más reciente primero.
  visibles.sort((a, b) => (filtro === "abiertos" ? a.row.received_at.localeCompare(b.row.received_at) : b.row.received_at.localeCompare(a.row.received_at)));

  const tiempos = conEstado
    .filter((item) => item.row.respuesta && item.row.respuesta.estado !== "fallido")
    .map((item) => new Date(item.row.respuesta!.created_at).getTime() - new Date(item.row.received_at).getTime())
    .sort((a, b) => a - b);
  const mediana = tiempos.length ? tiempos[Math.floor(tiempos.length / 2)] : null;
  const buzones = [...new Set(rows.map((row) => row.mailbox))];

  const baldosas: Array<{ id: typeof filtro; label: string; count: number; description: string; tone: "danger" | "warning" | "success" | "neutral" | "info" }> = [
    { id: "abiertos", label: "Por atender", count: abiertos, description: "Sin asignar o pendientes del ejecutivo", tone: "info" },
    { id: "sin_asignar", label: "Sin asignar", count: conteo("sin_asignar"), description: "Sin dueño o sin registro: asigna o liga por RUT", tone: "danger" },
    { id: "pendiente", label: "Pendiente del ejecutivo", count: conteo("pendiente"), description: "Asignados, todavía sin respuesta", tone: "warning" },
    { id: "respondido", label: "Respondidos", count: conteo("respondido"), description: mediana !== null ? `Primera respuesta en ${duracion(new Date(ahora - mediana).toISOString(), ahora)} (mediana)` : "Contestados desde la ficha", tone: "success" },
    { id: "cerrado", label: "Cerrados sin correo", count: conteo("cerrado"), description: "Atendidos por otro medio o descartados", tone: "neutral" },
    { id: "todos", label: "Todos", count: rows.length, description: "Últimos 30 días", tone: "neutral" },
  ];

  return (
    <SectionCard
      title="Buzón de la cuenta"
      description={buzones.length ? `Respuestas que llegaron a ${buzones.join(", ")}. Cada una se liga al registro y queda con su dueño.` : "Respuestas de clientes al buzón de envío."}
      icon={Inbox}
      tone="teal"
      actions={<Badge tone={abiertos > 0 ? "warning" : "success"}>{abiertos > 0 ? `${abiertos} por atender` : "Al día"}</Badge>}
    >
      <div className="border-b border-border px-4 py-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {baldosas.map((baldosa) => {
            const activa = filtro === baldosa.id;
            const estilo = tonoBaldosa(baldosa.tone);
            return (
              <button
                key={baldosa.id}
                type="button"
                onClick={() => setFiltro(baldosa.id)}
                aria-pressed={activa}
                className={`rounded-lg border border-l-2 px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${estilo.edge} ${
                  activa ? "border-primary/50 bg-primary/10 shadow-sm ring-1 ring-primary/40" : "border-border bg-background hover:border-border-strong hover:bg-surface-muted"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{baldosa.label}</span>
                  <span className={`text-xl font-semibold leading-none tracking-tight tabular-nums ${baldosa.count > 0 ? estilo.value : "text-muted-foreground"}`}>
                    {baldosa.count.toLocaleString("es-CL")}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{baldosa.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {visibles.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={rows.length === 0 ? "Todavía no llegan respuestas" : "Nada en este estado"}
          description={rows.length === 0 ? "Cuando un cliente responda una propuesta, aparece acá con su registro y su dueño." : "Elige otro estado arriba."}
        />
      ) : (
        <div className="max-h-[34rem] divide-y divide-border overflow-y-auto">
          {visibles.map(({ row, estado }) => {
            const info = ESTADO[estado];
            const Icono = info.icon;
            const espera = estado === "sin_asignar" || estado === "pendiente" ? ahora - new Date(row.received_at).getTime() : 0;
            const tonoEspera = espera > 24 * 3_600_000 ? "text-danger" : espera > 4 * 3_600_000 ? "text-warning" : "text-muted-foreground";
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => setAbierto(row)}
                className="group flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground group-hover:text-primary">{row.lead_name ?? row.from_name ?? row.from_address}</p>
                    <Badge tone={info.tone}>
                      <Icono size={12} className="mr-1" aria-hidden /> {info.label}
                    </Badge>
                    {!row.lead_id && <Badge tone="danger">Sin registro</Badge>}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-foreground/80">{row.subject}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {row.lead_rut && <span>{row.lead_rut}</span>}
                    <span>{row.from_address}</span>
                    <span className={`inline-flex items-center gap-1 ${tonoEspera}`}>
                      <Clock3 size={12} aria-hidden /> {fecha.format(new Date(row.received_at))}
                      {espera > 0 && ` · espera ${duracion(row.received_at, ahora)}`}
                    </span>
                    {row.respuesta && estado === "respondido" && (
                      <span>Respondió {row.respuesta.agente} en {duracion(row.received_at, new Date(row.respuesta.created_at).getTime())}</span>
                    )}
                  </div>
                </div>
                <div className="hidden shrink-0 items-center gap-2 sm:flex">
                  <span className="max-w-40 truncate text-xs text-muted-foreground">{row.assigned_name ?? "Sin asignar"}</span>
                  <ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <DetalleCorreo row={abierto} agents={agents} onClose={() => setAbierto(null)} />
    </SectionCard>
  );
}

function DetalleCorreo({ row, agents, onClose }: { row: BuzonRow | null; agents: BuzonAgent[]; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [agente, setAgente] = useState("");
  const [rut, setRut] = useState("");
  const estado = row ? estadoDe(row) : null;

  function guardar(accion: { agenteId?: string; rut?: string; cerrar?: boolean }, exito: string) {
    if (!row) return;
    startTransition(async () => {
      const resultado = await gestionarCorreoDeBuzon({ correoId: row.id, ...accion });
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      toast({ tone: "success", message: exito });
      setAgente("");
      setRut("");
      onClose();
      router.refresh();
    });
  }

  return (
    <SlideOver
      open={row !== null}
      onClose={onClose}
      title={row?.lead_name ?? row?.from_name ?? row?.from_address ?? "Correo"}
      description={row?.subject}
      width="md"
    >
      {row && estado && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Dato label="Estado" value={ESTADO[estado].label} />
            <Dato label="Recibido" value={fecha.format(new Date(row.received_at))} />
            <Dato label="Responsable" value={row.assigned_name ? `${row.assigned_name}${row.asignacion ? ` · ${MOTIVO[row.asignacion]}` : ""}` : "Sin asignar"} />
            <Dato label="Registro" value={row.lead_name ? `${row.lead_name}${row.lead_rut ? ` · ${row.lead_rut}` : ""}` : "Sin registro"} />
          </div>

          <div className="rounded-xl border border-border bg-background p-4">
            <p className="text-xs text-muted-foreground">{row.from_name ? `${row.from_name} · ` : ""}{row.from_address}</p>
            <p className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{sinCita(row.body_text) || "(sin texto)"}</p>
          </div>

          {row.respuesta && (
            <p className="text-sm text-muted-foreground">
              {row.respuesta.estado === "fallido"
                ? `La respuesta de ${row.respuesta.agente} no salió; sigue abierto.`
                : `${row.respuesta.agente} respondió el ${fecha.format(new Date(row.respuesta.created_at))}.`}
            </p>
          )}

          {!row.lead_id && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground" htmlFor="buzon-rut">Ligar a un registro</label>
              <div className="flex gap-2">
                <Input id="buzon-rut" value={rut} onChange={(event) => setRut(event.target.value)} placeholder="RUT del cliente, p. ej. 76.123.456-7" className="flex-1" />
                <Button type="button" variant="secondary" disabled={pending || rut.trim().length < 3} onClick={() => guardar({ rut }, "Correo ligado al registro")}>Ligar</Button>
              </div>
              <p className="text-xs text-muted-foreground">Se busca en las campañas del buzón. Si el registro tiene agenda o ejecutivo, queda asignado a esa persona.</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground" htmlFor="buzon-agente">
              {row.assigned_to ? "Reasignar a" : "Asignar a"}
            </label>
            <div className="flex gap-2">
              <Select id="buzon-agente" value={agente} onChange={(event) => setAgente(event.target.value)} className="flex-1">
                <option value="">Selecciona un ejecutivo</option>
                {agents.filter((agent) => agent.id !== row.assigned_to).map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.full_name || agent.email}</option>
                ))}
              </Select>
              <Button type="button" disabled={pending || !agente} onClick={() => guardar({ agenteId: agente }, "Correo asignado")}>
                <UserRound size={14} aria-hidden /> {row.assigned_to ? "Reasignar" : "Asignar"}
              </Button>
            </div>
            {!row.lead_id && <p className="text-xs text-muted-foreground">Sin registro, el ejecutivo no lo verá en una ficha: conviene ligarlo primero.</p>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            {row.lead_id ? (
              <Link href={`/dashboard/leads/${row.lead_id}`} className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-surface-muted">
                Abrir ficha y responder
              </Link>
            ) : <span />}
            {(estado === "sin_asignar" || estado === "pendiente") && (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => guardar({ cerrar: true }, "Correo cerrado")}>
                <XCircle size={14} aria-hidden /> Cerrar sin responder
              </Button>
            )}
          </div>
        </div>
      )}
    </SlideOver>
  );
}

function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}
