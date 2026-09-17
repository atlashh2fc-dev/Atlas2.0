import Link from "next/link";
import { notFound } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";

import { moverEtapa, registrarGestion } from "@/app/actions/ventas";
import {
  ActionForm,
  ActionSubmit,
  Badge,
  Field,
  Input,
  PageHeader,
  SectionCard,
  Select,
  Table,
  TableEmpty,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@/components/ui";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

/** Sin precio acordado todavía, decirlo vale más que un "$0" que parece un dato. */
function montoMensual(valor: unknown): string {
  const numero = Number(valor ?? 0);
  return numero > 0 ? `${pesos.format(numero)} al mes` : "Monto por definir";
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
      "id, name, status, monthly_amount, one_time_amount, expected_close_date, next_action_at, next_action_note, source, lost_reason, stage_id, sales_companies(id, name, rut, industry, commune, website), sales_contacts(id, full_name, role_title, email, phone), sales_stages(key, name)",
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
  const etapaActual = primero(negocio.sales_stages);
  const abierto = negocio.status === "abierta";

  return (
    <div className="space-y-5">
      <PageHeader
        title={empresa?.name ?? "Negocio"}
        description={`${negocio.name} · ${montoMensual(negocio.monthly_amount)}`}
        actions={
          <Link
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            href="/dashboard/ventas"
          >
            Volver al embudo
          </Link>
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <SectionCard title="Estado" description="En qué va el negocio.">
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

        <SectionCard title="Empresa" description="Con quién se está hablando.">
          <div className="space-y-1 px-5 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{empresa?.name}</p>
            {empresa?.rut && <p>RUT {empresa.rut}</p>}
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
      </div>

      {abierto && (
        <SectionCard title="Mover el negocio" description="Cada movimiento queda registrado en la historia.">
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

      <SectionCard title="Historia" description="Todo lo que pasó con este negocio.">
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
