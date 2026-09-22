import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";

import { moverEtapa, registrarGestion } from "@/app/actions/ventas";
import { cerrarNegocio, escribirAlNegocio, fijarProximaAccion } from "@/app/actions/pipeline";
import { ETIQUETA_ESTADO_MENSAJE, type EstadoMensaje } from "@/lib/mensajes/plantillas";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  buttonClasses,
  Field,
  Input,
  PageHeader,
  SectionCard,
  Select,
  SubmitButton,
  Table,
  TableEmpty,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { VENTAS_POR_EDICION } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

/** Sin precio acordado todavía, decirlo vale más que un "$0" que parece un dato. */
function formatoMonto(numero: number, mensual: boolean): string {
  return numero > 0 ? `${pesos.format(numero)}${mensual ? " al mes" : ""}` : "Monto por definir";
}

/** Lo que una clínica guarda de la persona además de sus datos: mascota, profesional. */
function detallePersona(metadata: unknown): { etiqueta: string; valor: string }[] {
  if (!metadata || typeof metadata !== "object") return [];
  const datos = metadata as Record<string, unknown>;
  const filas: { etiqueta: string; valor: string }[] = [];
  const mascota = [datos.mascota, datos.especie, datos.raza].filter((valor) => typeof valor === "string" && valor);
  if (mascota.length > 0) filas.push({ etiqueta: "Mascota", valor: mascota.join(" · ") });
  if (typeof datos.profesional === "string" && datos.profesional) {
    filas.push({ etiqueta: "Profesional", valor: datos.profesional });
  }
  if (typeof datos.prevision === "string" && datos.prevision) {
    filas.push({ etiqueta: "Previsión", valor: datos.prevision });
  }
  return filas;
}
const cuando = new Intl.DateTimeFormat("es-CL", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const ETIQUETA_GESTION: Record<string, string> = {
  llamada: "Llamada",
  correo: "Correo",
  whatsapp: "WhatsApp",
  reunion: "Reunión",
  nota: "Nota",
  tarea: "Tarea",
  etapa: "Embudo",
};

/** Supabase entrega las relaciones como arreglo; acá siempre es una sola fila. */
function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

/** Ficha del negocio: quién es, en qué va, qué se hizo y qué sigue. */
export default async function OportunidadPage({ params }: { params: Promise<{ id: string }> }) {
  noStore();
  await requireProfile(["admin", "supervisor"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: negocio } = await supabase
    .from("sales_opportunities")
    .select(
      "id, name, status, monthly_amount, one_time_amount, expected_close_date, next_action_at, next_action_note, source, lost_reason, stage_id, sales_companies(id, name, rut, industry, commune, website, phone, email, metadata), sales_contacts(id, full_name, role_title, email, phone), sales_stages(key, name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!negocio) notFound();

  const [{ data: etapas }, { data: gestiones }] = await Promise.all([
    supabase
      .from("sales_stages")
      .select("key, name, position, is_won, is_lost")
      .eq("active", true)
      .order("position"),
    supabase
      .from("sales_activities")
      .select("id, kind, subject, body, occurred_at, due_at, done")
      .eq("opportunity_id", id)
      .order("occurred_at", { ascending: false })
      .limit(100),
  ]);

  const empresa = primero(negocio.sales_companies);
  const contacto = primero(negocio.sales_contacts);
  const { data: mensajesData } = await supabase
    .from("mensajes_salientes")
    .select("id, canal, asunto, cuerpo, estado, error, created_at")
    .eq("origen_ref", negocio.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const mensajesEnviados = (mensajesData ?? []) as { id: string; canal: string; asunto: string | null; cuerpo: string | null; estado: string; error: string | null; created_at: string }[];
  const etapaActual = primero(negocio.sales_stages);
  const abierto = negocio.status === "abierta";
  const voc = VENTAS_POR_EDICION[(await contextoDeMiEmpresa()).edicion];
  const mensual = voc.monto === "mensual";
  const monto = Number((mensual ? negocio.monthly_amount : negocio.one_time_amount) ?? 0);
  const detalle = detallePersona(empresa?.metadata);
  // Escribir desde la ficha abre el correo o el WhatsApp de quien atiende; lo
  // que se conversó se registra abajo, en "Registrar gestión".
  const correo = contacto?.email ?? empresa?.email ?? null;
  const telefono = (contacto?.phone ?? empresa?.phone ?? "").replace(/\D/g, "");
  const whatsapp = telefono.length >= 11 ? telefono : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={empresa?.name ?? voc.negocio}
        description={`${negocio.name} · ${formatoMonto(monto, mensual)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {correo && (
              <a
                className={buttonClasses({ variant: "secondary", size: "sm" })}
                href={`mailto:${correo}?subject=${encodeURIComponent(`${negocio.name}`)}`}
              >
                Escribir correo
              </a>
            )}
            {whatsapp && (
              <a
                className={buttonClasses({ variant: "secondary", size: "sm" })}
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp
              </a>
            )}
            <Link
              className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              href="/dashboard/ventas"
            >
              Volver a {voc.negocios.toLowerCase()}
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard title="Estado" description={`En qué va ${mensual ? "el negocio" : `el ${voc.negocio.toLowerCase()}`}.`}>
          <div className="space-y-2 px-5 py-4 text-sm">
            <p>
              <Badge tone={negocio.status === "ganada" ? "success" : negocio.status === "perdida" ? "danger" : "neutral"}>
                {etapaActual?.name ?? "Sin etapa"}
              </Badge>
            </p>
            <p className="text-muted-foreground">
              Próxima acción:{" "}
              {negocio.next_action_at
                ? `${cuando.format(new Date(negocio.next_action_at))}${negocio.next_action_note ? ` · ${negocio.next_action_note}` : ""}`
                : "sin agendar"}
            </p>
            {negocio.expected_close_date && (
              <p className="text-muted-foreground">Cierre estimado: {negocio.expected_close_date}</p>
            )}
            {negocio.source && <p className="text-muted-foreground">Origen: {negocio.source}</p>}
            {negocio.lost_reason && <p className="text-danger">Motivo de pérdida: {negocio.lost_reason}</p>}
          </div>
        </SectionCard>

        <SectionCard title={voc.cuenta} description="Con quién se está hablando.">
          <div className="space-y-1 px-5 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{empresa?.name}</p>
            {empresa?.rut && <p>RUT {empresa.rut}</p>}
            {voc.personas && (contacto?.phone ?? empresa?.phone) && <p>{contacto?.phone ?? empresa?.phone}</p>}
            {voc.personas && (contacto?.email ?? empresa?.email) && <p>{contacto?.email ?? empresa?.email}</p>}
            {empresa?.industry && <p>{empresa.industry}</p>}
            {empresa?.commune && <p>{empresa.commune}</p>}
            {empresa?.website && (
              <p>
                <a className="hover:underline" href={empresa.website} target="_blank" rel="noopener noreferrer">
                  {empresa.website}
                </a>
              </p>
            )}
          </div>
        </SectionCard>

        {voc.personas ? (
          <SectionCard title="Ficha" description="Lo que la clínica sabe de este caso.">
            {detalle.length > 0 ? (
              <dl className="space-y-1 px-5 py-4 text-sm">
                {detalle.map((fila) => (
                  <div key={fila.etiqueta} className="flex gap-2">
                    <dt className="text-muted-foreground">{fila.etiqueta}:</dt>
                    <dd className="font-medium text-foreground">{fila.valor}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="px-5 py-4 text-sm text-muted-foreground">Sin datos adicionales.</p>
            )}
          </SectionCard>
        ) : (
        <SectionCard title="Contacto" description="Quién decide o responde.">
          {contacto ? (
            <div className="space-y-1 px-5 py-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{contacto.full_name}</p>
              {contacto.role_title && <p>{contacto.role_title}</p>}
              {contacto.email && <p>{contacto.email}</p>}
              {contacto.phone && <p>{contacto.phone}</p>}
            </div>
          ) : (
            <p className="px-5 py-4 text-sm text-muted-foreground">Sin contacto registrado.</p>
          )}
        </SectionCard>
        )}
      </div>

      {abierto && (
        <SectionCard title={mensual ? "Mover el negocio" : `Mover el ${voc.negocio.toLowerCase()}`} description="Cada movimiento queda registrado en la historia.">
          <ActionForm action={moverEtapa} success="Etapa actualizada">
            <input type="hidden" name="oportunidad_id" value={negocio.id} />
            <div className="flex flex-wrap items-end gap-3 px-5 py-4">
              <Field label="Etapa">
                <Select name="etapa" defaultValue={etapaActual?.key ?? ""}>
                  {(etapas ?? []).map((etapa) => (
                    <option key={etapa.key} value={etapa.key}>
                      {etapa.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Nota (motivo si se pierde)">
                <Input name="nota" placeholder="Pidió esperar al próximo trimestre" />
              </Field>
              <ActionSubmit>Actualizar</ActionSubmit>
            </div>
          </ActionForm>
        </SectionCard>
      )}

      <SectionCard title="Registrar gestión" description="Con fecha futura queda como la próxima acción.">
        <ActionForm action={registrarGestion} success="Gestión registrada">
          <input type="hidden" name="oportunidad_id" value={negocio.id} />
          <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            <Field label="Tipo">
              <Select name="tipo" defaultValue="llamada">
                <option value="llamada">Llamada</option>
                <option value="correo">Correo</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="reunion">Reunión</option>
                <option value="nota">Nota</option>
                <option value="tarea">Tarea</option>
              </Select>
            </Field>
            <Field label="Qué pasó o qué hay que hacer">
              <Input name="asunto" required placeholder="Le envié la propuesta" />
            </Field>
            <Field label="Cuándo (opcional)">
              <Input name="vence" type="datetime-local" />
            </Field>
            <ActionSubmit>Registrar</ActionSubmit>
          </div>
        </ActionForm>
      </SectionCard>

      <SectionCard title="Escribir desde Atlas" description="Correo al contacto del negocio por el puente con Atlas Lead; WhatsApp si la empresa tiene el canal. Queda en la historia y con su estado.">
        <div className="grid gap-4 px-4 py-4 lg:grid-cols-[1fr_320px]">
          <form action={escribirAlNegocio} className="space-y-2">
            <input type="hidden" name="oportunidad_id" value={negocio.id} />
            <input type="hidden" name="cuenta_id" value={empresa?.id ?? ""} />
            <div className="flex flex-wrap gap-2">
              <Select name="canal" defaultValue="correo" aria-label="Canal" className="w-40">
                <option value="correo">Correo{(empresa?.email ?? contacto?.email) ? ` · ${empresa?.email ?? contacto?.email}` : " · sin correo"}</option>
                <option value="whatsapp">WhatsApp{(empresa?.phone ?? contacto?.phone) ? ` · ${empresa?.phone ?? contacto?.phone}` : " · sin celular"}</option>
              </Select>
              <Input name="asunto" placeholder="Asunto (correo)" className="flex-1" defaultValue={`Sobre ${negocio.name}`} />
            </div>
            <textarea name="texto" required rows={4} maxLength={5000} placeholder={`Hola ${contacto?.full_name?.split(" ")[0] ?? ""}, …`} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
            <SubmitButton pendingLabel="Enviando…">Enviar</SubmitButton>
          </form>
          <div className="space-y-3">
            <form action={fijarProximaAccion} className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Próxima acción</p>
              <input type="hidden" name="oportunidad_id" value={negocio.id} />
              <div className="flex gap-2">
                <Input type="date" name="fecha" required className="flex-1" />
                <Input type="time" name="hora" defaultValue="09:00" className="w-28" />
              </div>
              <Input name="nota" placeholder="Qué toca hacer" defaultValue={negocio.next_action_note ?? ""} />
              <SubmitButton size="sm" variant="secondary" pendingLabel="…">Fijar</SubmitButton>
            </form>
            {negocio.status === "abierta" && (
              <form action={cerrarNegocio} className="space-y-2 rounded-lg border border-border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Cerrar</p>
                <input type="hidden" name="oportunidad_id" value={negocio.id} />
                <Input name="motivo" placeholder="Motivo si se pierde" />
                <div className="flex gap-2">
                  <button type="submit" name="resultado" value="ganado" className={buttonClasses({ size: "sm" })}>Ganado</button>
                  <button type="submit" name="resultado" value="perdido" className={buttonClasses({ variant: "danger", size: "sm" })}>Perdido</button>
                </div>
              </form>
            )}
          </div>
        </div>
        {mensajesEnviados.length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            {mensajesEnviados.map((mensaje) => {
              const etiqueta = ETIQUETA_ESTADO_MENSAJE[mensaje.estado as EstadoMensaje] ?? ETIQUETA_ESTADO_MENSAJE.programado;
              return (
                <li key={mensaje.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="w-20 text-xs text-muted-foreground">{mensaje.canal === "correo" ? "Correo" : "WhatsApp"}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{mensaje.asunto ?? mensaje.cuerpo ?? ""}</span>
                  <Badge tone={etiqueta.tone}>{etiqueta.label}</Badge>
                  {mensaje.error && <span className="text-xs text-danger">{mensaje.error}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Historia" description={`Todo lo que pasó con ${mensual ? "este negocio" : `este ${voc.negocio.toLowerCase()}`}.`}>
        <Table>
          <Thead>
            <Th>Cuándo</Th>
            <Th>Tipo</Th>
            <Th>Detalle</Th>
            <Th>Estado</Th>
          </Thead>
          <Tbody>
            {(gestiones ?? []).length === 0 && <TableEmpty colSpan={4}>Sin gestiones todavía.</TableEmpty>}
            {(gestiones ?? []).map((gestion) => (
              <Tr key={gestion.id}>
                <Td className="whitespace-nowrap text-muted-foreground">
                  {cuando.format(new Date(gestion.due_at ?? gestion.occurred_at))}
                </Td>
                <Td>{ETIQUETA_GESTION[gestion.kind] ?? gestion.kind}</Td>
                <Td>
                  <span className="text-foreground">{gestion.subject ?? "—"}</span>
                  {gestion.body && <span className="block text-xs text-muted-foreground">{gestion.body}</span>}
                </Td>
                <Td>
                  <Badge tone={gestion.done ? "neutral" : "warning"}>{gestion.done ? "Hecho" : "Pendiente"}</Badge>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </SectionCard>
    </div>
  );
}
