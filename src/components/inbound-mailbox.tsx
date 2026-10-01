"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Clock3, Mail, MailX, Phone, RefreshCw, Search, ShieldCheck, Trash2, UserRoundPlus, X } from "lucide-react";

import { convertInboundEmail, deleteInboundEmails, syncInboundMailbox } from "@/app/actions/mail";
import { Avatar, Badge, Button, Callout, EmptyState, Input, Select, SlideOver } from "@/components/ui";
import { useToast } from "@/components/ui/toast";

export type InboundEmailRow = {
  id: string;
  from_name: string | null;
  from_address: string;
  subject: string;
  body_text: string;
  preview: string;
  detected_phone: string | null;
  received_at: string;
  status: "new" | "converted";
  lead_id: string | null;
};

type MailboxState = {
  id: string;
  address: string;
  label: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
};

type AgentOption = { id: string; full_name: string; email: string };

function formatDate(value: string | null) {
  if (!value) return "Nunca";
  return new Date(value).toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const diaChile = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" });
const horaChile = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit" });
const diaCorto = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "numeric", month: "short" });

/** "09:27" si llegó hoy, "Ayer" y después la fecha corta; la fecha completa queda en el título. */
function fechaCorta(value: string) {
  const fecha = new Date(value);
  const ahora = new Date();
  const dia = diaChile.format(fecha);
  if (dia === diaChile.format(ahora)) return horaChile.format(fecha);
  if (dia === diaChile.format(new Date(ahora.getTime() - 86_400_000))) return "Ayer";
  return diaCorto.format(fecha);
}

function isBounce(message: InboundEmailRow) {
  const value = `${message.from_address} ${message.from_name ?? ""} ${message.subject}`.toLocaleLowerCase("es");
  return /mailer-daemon|postmaster|delivery status|delivery failure|undeliver|mail delivery|returned mail|no entregado|rebot/.test(value);
}

export function InboundMailbox({
  mailbox,
  campaignName,
  messages,
  agents,
}: {
  mailbox: MailboxState | null;
  campaignName: string;
  messages: InboundEmailRow[];
  agents: AgentOption[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<InboundEmailRow | null>(null);
  const [isSyncing, startSync] = useTransition();
  const [isConverting, startConversion] = useTransition();
  const [isDeleting, startDeletion] = useTransition();
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [query, setQuery] = useState("");
  const [bounceOnly, setBounceOnly] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [deleteIds, setDeleteIds] = useState<string[]>([]);

  const filteredMessages = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    return messages.filter((message) => {
      if (bounceOnly && !isBounce(message)) return false;
      if (!normalized) return true;
      return [message.from_address, message.from_name ?? "", message.subject]
        .some((value) => value.toLocaleLowerCase("es").includes(normalized));
    });
  }, [bounceOnly, messages, query]);

  const visibleIds = filteredMessages.map((message) => message.id);
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every((id) => checkedIds.has(id));

  const toggleChecked = (id: string) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (allVisibleChecked) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const openMessage = (message: InboundEmailRow) => {
    setSelected(message);
    setPhone(message.detected_phone ?? "");
    setFullName(message.from_name ?? "");
    setAgentId("");
  };

  const runSync = () => {
    startSync(async () => {
      try {
        const result = await syncInboundMailbox();
        toast({
          tone: "success",
          message: result.imported > 0
            ? `${result.imported} correo(s) sincronizado(s).`
            : "La bandeja ya estaba al día.",
        });
        router.refresh();
      } catch (error) {
        toast({ tone: "danger", message: error instanceof Error ? error.message : "No se pudo sincronizar." });
      }
    });
  };

  const runConversion = () => {
    if (!selected) return;
    startConversion(async () => {
      const result = await convertInboundEmail(selected.id, agentId, phone, fullName);
      if (!result.ok) {
        toast({ tone: "danger", message: result.error || "No se pudo crear el lead." });
        return;
      }
      toast({ tone: "success", message: "Correo convertido y asignado para contacto telefónico." });
      setSelected(null);
      router.refresh();
    });
  };

  const runDeletion = () => {
    if (deleteIds.length === 0) return;
    startDeletion(async () => {
      try {
        const result = await deleteInboundEmails(deleteIds);
        toast({
          tone: "success",
          message: result.movedToTrash
            ? `${result.deleted} correo(s) movido(s) a la Papelera del servidor.`
            : `${result.deleted} correo(s) eliminado(s) del servidor.`,
        });
        setCheckedIds(new Set());
        setDeleteIds([]);
        if (selected && deleteIds.includes(selected.id)) setSelected(null);
        router.refresh();
      } catch (error) {
        toast({ tone: "danger", message: error instanceof Error ? error.message : "No se pudieron eliminar." });
      }
    });
  };

  return (
    <>
      <section className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <Avatar name={mailbox?.label ?? campaignName} icon={Mail} shape="square" size="md" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              <h2 className="text-[15px] font-semibold text-foreground">{mailbox?.label ?? campaignName}</h2>
              <Badge tone="neutral">Solo lectura, sin respuestas</Badge>
            </div>
            <p className="truncate text-xs text-muted-foreground">{mailbox?.address ?? "contacto@abogadolegal.cl"}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <p className="hidden text-right text-xs text-muted-foreground sm:block">
              <span className="block">Última sincronización</span>
              <span className="font-medium text-foreground">{formatDate(mailbox?.last_synced_at ?? null)}</span>
            </p>
            <Button type="button" variant="secondary" onClick={runSync} disabled={isSyncing || !mailbox}>
              <RefreshCw size={15} className={isSyncing ? "animate-spin" : ""} />
              {isSyncing ? "Sincronizando…" : "Sincronizar"}
            </Button>
          </div>
        </header>

        {mailbox?.last_sync_error && (
          <div className="border-b border-danger/25 bg-danger-bg px-5 py-2 text-sm text-danger">
            Último intento: {mailbox.last_sync_error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-raised px-5 py-2.5">
          <label className="relative min-w-[16rem] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por correo, remitente o asunto…"
              className="w-full pl-9 pr-9"
              aria-label="Buscar correos"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={15} />
              </button>
            )}
          </label>
          {/* Todos o solo rebotes: un riel de dos opciones, no un botón que cambia de color. */}
          <div role="group" aria-label="Qué correos ver" className="inline-flex gap-0.5 rounded-lg bg-surface-muted p-0.5">
            {[
              { valor: false, texto: "Todos" },
              { valor: true, texto: "Rebotes" },
            ].map((opcion) => (
              <button
                key={opcion.texto}
                type="button"
                aria-pressed={bounceOnly === opcion.valor}
                onClick={() => setBounceOnly(opcion.valor)}
                className={`inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${bounceOnly === opcion.valor ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {opcion.texto}
              </button>
            ))}
          </div>
          <span className="rounded-md bg-surface-muted px-1.5 py-px text-[11px] font-semibold tabular-nums text-muted-foreground" title="Resultados">
            {filteredMessages.length.toLocaleString("es-CL")}
          </span>
        </div>

        {filteredMessages.length > 0 && (
          <div className="flex min-h-11 flex-wrap items-center gap-3 border-b border-border px-5 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={allVisibleChecked}
                onChange={toggleAllVisible}
                className="h-4 w-4 accent-primary"
              />
              Seleccionar resultados visibles
            </label>
            {checkedIds.size > 0 && (
              <>
                <span className="text-xs font-medium text-foreground">{checkedIds.size} seleccionado(s)</span>
                <Button type="button" size="sm" variant="danger" onClick={() => setDeleteIds([...checkedIds])} className="ml-auto">
                  <Trash2 size={14} /> Eliminar seleccionados
                </Button>
              </>
            )}
          </div>
        )}

        <div className="divide-y divide-border/70">
          {filteredMessages.length === 0 && (
            <EmptyState
              icon={Search}
              title="No encontramos correos"
              description="Cambia la búsqueda o desactiva el filtro de rebotes."
              className="py-14"
            />
          )}
          {filteredMessages.map((message) => {
            const rebote = isBounce(message);
            const remitente = message.from_name || message.from_address;
            const nuevo = message.status !== "converted";
            return (
              <article
                key={message.id}
                className={`group flex items-center gap-3 px-5 py-3 transition-colors ${checkedIds.has(message.id) ? "bg-primary/[0.06]" : "hover:bg-surface-muted/55"}`}
              >
                <input
                  type="checkbox"
                  checked={checkedIds.has(message.id)}
                  onChange={() => toggleChecked(message.id)}
                  aria-label={`Seleccionar correo ${message.subject}`}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <button type="button" onClick={() => openMessage(message)} className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {/* Un rebote no es una persona: va con el ícono y en rosa. */}
                  {rebote ? (
                    <Avatar icon={MailX} tone="rose" shape="square" size="md" />
                  ) : (
                    <Avatar name={remitente} seed={message.from_address} size="md" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={`truncate text-[13px] text-foreground ${nuevo ? "font-semibold" : "font-medium"}`}>{remitente}</span>
                      <time dateTime={message.received_at} title={formatDate(message.received_at)} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {fechaCorta(message.received_at)}
                      </time>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-xs">
                        <span className="text-foreground">{message.subject}</span>
                        <span className="text-muted-foreground"> — {message.preview || "Mensaje sin texto visible"}</span>
                      </span>
                      {message.status === "converted" ? <Badge tone="success">Convertido</Badge> : <Badge tone="info">Nuevo</Badge>}
                    </span>
                  </span>
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <SlideOver
        open={selected !== null}
        onClose={() => setSelected(null)}
        width="lg"
        title={selected?.subject ?? "Correo recibido"}
        description={selected ? `${selected.from_name || selected.from_address} · ${formatDate(selected.received_at)}` : undefined}
      >
        {selected && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck size={14} className="text-muted-foreground" aria-hidden="true" />
                Esta bandeja no permite responder ni enviar correos.
              </p>
              <Button type="button" size="sm" variant="danger" onClick={() => setDeleteIds([selected.id])}>
                <Trash2 size={14} /> Eliminar correo
              </Button>
            </div>

            <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl bg-surface-muted/60 p-4 text-sm leading-6 text-foreground">
              {selected.body_text || "Este correo no contiene texto visible."}
            </div>

            {selected.status === "converted" && selected.lead_id ? (
              <Callout tone="success" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="font-medium">Este correo ya fue convertido en lead.</span>
                <Link href={`/dashboard/leads/${selected.lead_id}`} className="text-sm font-medium text-primary hover:underline">
                  Abrir registro
                </Link>
              </Callout>
            ) : (
              <div className="space-y-4 border-t border-border pt-5">
                <div>
                  <div className="flex items-center gap-2">
                    <UserRoundPlus size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <h3 className="font-semibold text-foreground">Convertir para contacto telefónico</h3>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">Se creará o reutilizará un registro en la campaña {campaignName} y quedará asignado de inmediato.</p>
                </div>

                <label className="block text-sm font-medium text-foreground">
                  Nombre del contacto
                  <Input className="mt-1.5 w-full" value={fullName} onChange={(event) => setFullName(event.target.value)} data-autofocus />
                </label>

                <label className="block text-sm font-medium text-foreground">
                  <span className="flex items-center gap-1.5"><Phone size={14} /> Teléfono</span>
                  <Input className="mt-1.5 w-full" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+56 9 1234 5678" />
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">Puedes completarlo o corregirlo antes de crear el lead.</span>
                </label>

                <label className="block text-sm font-medium text-foreground">
                  Ejecutivo responsable
                  <Select className="mt-1.5 w-full" value={agentId} onChange={(event) => setAgentId(event.target.value)} required>
                    <option value="">Selecciona un ejecutivo</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.full_name || agent.email}</option>)}
                  </Select>
                </label>

                {agents.length === 0 && (
                  <Callout tone="warning" className="p-3">
                    No hay ejecutivos activos asignados a esta campaña.
                  </Callout>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="secondary" onClick={() => setSelected(null)}>Cancelar</Button>
                  <Button type="button" onClick={runConversion} disabled={isConverting || !agentId || agents.length === 0}>
                    <Clock3 size={15} />
                    {isConverting ? "Creando lead…" : "Crear y asignar lead"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </SlideOver>

      <SlideOver
        open={deleteIds.length > 0}
        onClose={() => !isDeleting && setDeleteIds([])}
        width="sm"
        title={`Eliminar ${deleteIds.length} correo(s)`}
        description="Esta acción también se ejecutará en el servidor de correo."
      >
        <div className="space-y-5">
          <Callout tone="danger">
            Los mensajes desaparecerán de Atlas y se moverán a la Papelera del webmail cuando esté disponible. Los leads ya creados no se eliminarán.
          </Callout>
          <p className="text-sm text-muted-foreground">
            Confirma solo si seleccionaste exactamente los correos que quieres quitar.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeleteIds([])} disabled={isDeleting}>Cancelar</Button>
            <Button type="button" variant="danger" onClick={runDeletion} disabled={isDeleting}>
              <Trash2 size={15} /> {isDeleting ? "Eliminando…" : "Sí, eliminar del servidor"}
            </Button>
          </div>
        </div>
      </SlideOver>
    </>
  );
}
