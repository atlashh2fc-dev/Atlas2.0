import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import { crearOportunidad } from "@/app/actions/ventas";
import { CreatePanel } from "@/components/create-panel";
import {
  Badge,
  EmptyState,
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

/** Supabase entrega las relaciones como arreglo; acá siempre es una sola fila. */
function primero<T>(valor: T | T[] | null | undefined): T | null {
  if (Array.isArray(valor)) return valor[0] ?? null;
  return valor ?? null;
}

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const fecha = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short" });

/**
 * Embudo de ventas B2B.
 *
 * Una oportunidad es una empresa que puede contratar: tiene monto, etapa y una
 * próxima acción con fecha. Lo que importa arriba es cuánto hay en juego y qué
 * toca hacer hoy; el detalle vive en la ficha.
 */
export default async function VentasPage() {
  noStore();
  await requireProfile(["admin", "supervisor"]);
  const supabase = await createClient();

  const [{ data: etapas }, { data: oportunidades }, { data: productos }] = await Promise.all([
    supabase
      .from("sales_stages")
      .select("id, key, name, position, probability, is_won, is_lost")
      .eq("active", true)
      .order("position"),
    supabase
      .from("sales_opportunities")
      .select(
        "id, name, status, monthly_amount, one_time_amount, expected_close_date, next_action_at, next_action_note, stage_id, company_id, sales_companies(name), sales_stages(key, name, is_won, is_lost)",
      )
      .order("next_action_at", { ascending: true, nullsFirst: false })
      .limit(300),
    supabase
      .from("sales_products")
      .select("code, name, monthly_price")
      .eq("active", true)
      .order("name"),
  ]);

  const listaEtapas = etapas ?? [];
  const listaOportunidades = oportunidades ?? [];
  const abiertas = listaOportunidades.filter((negocio) => negocio.status === "abierta");
  const ganadas = listaOportunidades.filter((negocio) => negocio.status === "ganada");

  const mensualAbierto = abiertas.reduce((total, negocio) => total + Number(negocio.monthly_amount ?? 0), 0);
  const mensualGanado = ganadas.reduce((total, negocio) => total + Number(negocio.monthly_amount ?? 0), 0);

  // El corte es el instante de la petición: el panel se lee sin caché.
  const ahora = new Date().toISOString();
  const vencidas = abiertas.filter((negocio) => negocio.next_action_at && negocio.next_action_at <= ahora);

  const porEtapa = new Map<string, { nombre: string; total: number; monto: number }>();
  for (const etapa of listaEtapas) {
    porEtapa.set(etapa.id, { nombre: etapa.name, total: 0, monto: 0 });
  }
  for (const negocio of abiertas) {
    const casilla = porEtapa.get(negocio.stage_id);
    if (!casilla) continue;
    casilla.total += 1;
    casilla.monto += Number(negocio.monthly_amount ?? 0);
  }

  const nombreEmpresa = (negocio: (typeof listaOportunidades)[number]) =>
    primero(negocio.sales_companies)?.name ?? "—";
  const etapaDe = (negocio: (typeof listaOportunidades)[number]) =>
    primero(negocio.sales_stages)?.name ?? "—";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ventas"
        description="Empresas que pueden contratar, con su monto, su etapa y lo que toca hacer."
        actions={
          <CreatePanel
            label="Nueva oportunidad"
            title="Nueva oportunidad"
            description="Si la empresa ya existe, se reutiliza. El precio sale del catálogo salvo que escribas otro."
            action={crearOportunidad}
            submitLabel="Crear oportunidad"
            successLabel="Oportunidad creada"
          >
            <Field label="Empresa">
              <Input name="empresa" required placeholder="Panadería La Espiga Ltda" data-autofocus />
            </Field>
            <Field label="RUT (opcional)">
              <Input name="rut" placeholder="76.123.456-7" />
            </Field>
            <Field label="Negocio">
              <Input name="nombre" required placeholder="Atlas Pulso Crecimiento" />
            </Field>
            <Field label="Producto">
              <Select name="producto" defaultValue="">
                <option value="">Sin producto del catálogo</option>
                {(productos ?? []).map((producto) => (
                  <option key={producto.code} value={producto.code}>
                    {producto.name}
                    {producto.monthly_price ? ` · ${pesos.format(Number(producto.monthly_price))}/mes` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Monto mensual (deja vacío para usar el del catálogo)">
              <Input name="monto_mensual" inputMode="numeric" placeholder="69990" />
            </Field>
            <Field label="Contacto">
              <Input name="contacto" placeholder="María Soto" />
            </Field>
            <Field label="Correo del contacto">
              <Input name="contacto_email" type="email" placeholder="maria@laespiga.cl" />
            </Field>
            <Field label="WhatsApp o teléfono">
              <Input name="contacto_telefono" placeholder="+56 9 1111 1111" />
            </Field>
            <Field label="Cierre estimado">
              <Input name="cierre_estimado" type="date" />
            </Field>
            <Field label="Origen">
              <Select name="origen" defaultValue="">
                <option value="">Sin origen</option>
                <option value="campana_correo">Campaña de correo</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="web">Sitio web</option>
                <option value="referido">Referido</option>
                <option value="prospeccion">Prospección</option>
              </Select>
            </Field>
          </CreatePanel>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <SectionCard title="En juego" description="Suma mensual de los negocios abiertos.">
          <p className="text-2xl font-semibold text-foreground">{pesos.format(mensualAbierto)}</p>
          <p className="text-xs text-muted-foreground">{abiertas.length} abiertos</p>
        </SectionCard>
        <SectionCard title="Ganado" description="Mensual de los negocios cerrados.">
          <p className="text-2xl font-semibold text-foreground">{pesos.format(mensualGanado)}</p>
          <p className="text-xs text-muted-foreground">{ganadas.length} ganados</p>
        </SectionCard>
        <SectionCard title="Para hoy" description="Negocios con la próxima acción vencida.">
          <p className="text-2xl font-semibold text-foreground">{vencidas.length}</p>
          <p className="text-xs text-muted-foreground">de {abiertas.length} abiertos</p>
        </SectionCard>
      </div>

      <SectionCard title="Embudo" description="Cuánto hay en cada etapa, solo negocios abiertos.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {listaEtapas
            .filter((etapa) => !etapa.is_won && !etapa.is_lost)
            .map((etapa) => {
              const casilla = porEtapa.get(etapa.id);
              return (
                <div key={etapa.id} className="rounded-lg border border-border p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{etapa.name}</p>
                  <p className="mt-1 text-lg font-semibold text-foreground">{casilla?.total ?? 0}</p>
                  <p className="text-xs text-muted-foreground">{pesos.format(casilla?.monto ?? 0)}/mes</p>
                </div>
              );
            })}
        </div>
      </SectionCard>

      <SectionCard title="Negocios" description="Ordenados por la próxima acción: primero lo vencido.">
        {listaOportunidades.length === 0 ? (
          <EmptyState
            title="Todavía no hay oportunidades"
            description="Crea la primera con el botón de arriba, o deja que llegue desde una campaña."
          />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Empresa</Th>
                <Th>Negocio</Th>
                <Th>Etapa</Th>
                <Th>Mensual</Th>
                <Th>Próxima acción</Th>
              </Tr>
            </Thead>
            <Tbody>
              {listaOportunidades.length === 0 && <TableEmpty colSpan={5}>Sin negocios.</TableEmpty>}
              {listaOportunidades.map((negocio) => {
                const vencida =
                  negocio.status === "abierta" && negocio.next_action_at && negocio.next_action_at <= ahora;
                return (
                  <Tr key={negocio.id}>
                    <Td className="font-medium text-foreground">
                      <Link className="hover:underline" href={`/dashboard/ventas/${negocio.id}`}>
                        {nombreEmpresa(negocio)}
                      </Link>
                    </Td>
                    <Td className="text-muted-foreground">{negocio.name}</Td>
                    <Td>
                      <Badge
                        tone={
                          negocio.status === "ganada"
                            ? "success"
                            : negocio.status === "perdida"
                              ? "danger"
                              : "neutral"
                        }
                      >
                        {etapaDe(negocio)}
                      </Badge>
                    </Td>
                    <Td>{pesos.format(Number(negocio.monthly_amount ?? 0))}</Td>
                    <Td className={vencida ? "text-danger" : "text-muted-foreground"}>
                      {negocio.next_action_at
                        ? `${fecha.format(new Date(negocio.next_action_at))}${negocio.next_action_note ? ` · ${negocio.next_action_note}` : ""}`
                        : "Sin agendar"}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}
