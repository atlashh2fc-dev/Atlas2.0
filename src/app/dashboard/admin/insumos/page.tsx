import { connection } from "next/server";
import { Package, PackageX, Receipt, Wallet } from "lucide-react";

import { crearInsumo, guardarInsumo } from "@/app/actions/insumos";
import { CreatePanel } from "@/components/create-panel";
import { ActionForm, ActionSubmit, Avatar, Badge, Callout, EmptyState, Field, Input, PageHeader, SectionCard } from "@/components/ui";
import { KpiStrip, KpiStripItem } from "@/components/report-kit";
import { Conteo } from "../_diseno";
import { pesos, type Insumo } from "@/lib/arancel";
import { ATENCION_POR_EDICION, PACIENTES_POR_EDICION, clinicaDe, type Clinica } from "@/lib/ediciones";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { createClient } from "@/lib/supabase/server";

/**
 * Materiales e insumos de la clínica (productos, en la barbería).
 *
 * Cada material tiene su costo (para el margen), su precio si se cobra aparte
 * y su stock, que baja solo con cada atención. Arriba, lo que se gastó en los
 * últimos 30 días y lo que hay que reponer.
 */

/**
 * En una barbería lo que se gasta son productos (pomada, cuchillas), no
 * materiales clínicos: el texto sigue a la edición, como en el arancel.
 */
const VOCABULARIO: Record<Clinica, { singular: string; plural: string; nombre: string; categoria: string; unidad: string }> = {
  dental: { singular: "material", plural: "materiales", nombre: "Resina bulk fill", categoria: "Operatoria", unidad: "unidad, ml, dosis" },
  vet: { singular: "material", plural: "materiales", nombre: "Vacuna óctuple", categoria: "Vacunas", unidad: "unidad, ml, dosis" },
  barber: { singular: "producto", plural: "productos", nombre: "Pomada mate", categoria: "Peinado", unidad: "unidad, gramos, ml" },
};

function mayuscula(texto: string) {
  return `${texto[0].toUpperCase()}${texto.slice(1)}`;
}

const numero = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });

/** Desde cuándo se mide el consumo: hace 30 días. */
function hace30Dias() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

export default async function InsumosPage() {
  await connection();
  const { edicion } = await contextoDeMiEmpresa();
  const clinica = clinicaDe(edicion);
  const voc = VOCABULARIO[clinica];
  const lugar = ATENCION_POR_EDICION[clinica].lugar;
  const cliente = PACIENTES_POR_EDICION[clinica].singular.toLowerCase();
  const supabase = await createClient();
  const desde = hace30Dias();
  const [{ data, error }, { data: usos }] = await Promise.all([
    supabase
      .from("insumos")
      .select("id, codigo, nombre, categoria, unidad, costo, precio_venta, cobrable, stock, stock_minimo, activo")
      .order("categoria")
      .order("nombre"),
    supabase.from("atencion_insumos").select("insumo_id, cantidad, costo_unitario, precio_unitario, cobrado").gte("created_at", desde).limit(20000),
  ]);

  const insumos = (data ?? []) as unknown as Insumo[];
  const consumo = new Map<string, { cantidad: number; costo: number }>();
  let costoMes = 0;
  let cobradoMes = 0;
  for (const uso of usos ?? []) {
    const cantidad = Number(uso.cantidad);
    const costo = Number(uso.costo_unitario) * cantidad;
    costoMes += costo;
    if (uso.cobrado) cobradoMes += Number(uso.precio_unitario ?? 0) * cantidad;
    if (!uso.insumo_id) continue;
    const previo = consumo.get(uso.insumo_id as string) ?? { cantidad: 0, costo: 0 };
    consumo.set(uso.insumo_id as string, { cantidad: previo.cantidad + cantidad, costo: previo.costo + costo });
  }
  const bajos = insumos.filter((insumo) => insumo.activo && insumo.stock !== null && Number(insumo.stock) <= Number(insumo.stock_minimo ?? 0));
  const inventario = insumos.reduce((total, insumo) => total + Math.max(0, Number(insumo.stock ?? 0)) * Number(insumo.costo), 0);
  const masUsados = [...consumo.entries()].sort((a, b) => b[1].costo - a[1].costo).slice(0, 5);
  const nombre = new Map(insumos.map((insumo) => [insumo.id, insumo.nombre]));

  const grupos = new Map<string, Insumo[]>();
  for (const insumo of insumos) {
    const categoria = insumo.categoria ?? "Otros";
    grupos.set(categoria, [...(grupos.get(categoria) ?? []), insumo]);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${mayuscula(voc.plural)} e insumos`}
        icon={Package}
        description={`Lo que usa ${lugar}: el costo alimenta el margen de cada atención, los cobrables se suman a la cuenta y el stock baja solo al atender.`}
        actions={
          <CreatePanel
            label={`Nuevo ${voc.singular}`}
            title={`Nuevo ${voc.singular}`}
            description="Queda disponible para las recetas y las atenciones."
            action={crearInsumo}
            submitLabel={`Agregar ${voc.singular}`}
            successLabel={`${mayuscula(voc.singular)} agregado`}
          >
            <Field label="Nombre">
              <Input name="nombre" required placeholder={voc.nombre} data-autofocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Categoría">
                <Input name="categoria" placeholder={voc.categoria} />
              </Field>
              <Field label="Unidad">
                <Input name="unidad" placeholder={voc.unidad} />
              </Field>
              <Field label="Costo por unidad (CLP)">
                <Input name="costo" inputMode="numeric" placeholder="2500" />
              </Field>
              <Field label="Precio si se cobra aparte">
                <Input name="precio_venta" inputMode="numeric" placeholder="Opcional" />
              </Field>
              <Field label="Stock actual">
                <Input name="stock" inputMode="decimal" placeholder="Opcional" />
              </Field>
              <Field label="Avisar bajo">
                <Input name="stock_minimo" inputMode="decimal" placeholder="Opcional" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="cobrable" value="si" className="size-4 accent-[var(--primary)]" /> Se cobra aparte al {cliente}
            </label>
          </CreatePanel>
        }
      />

      {error && <Callout tone="danger">No se pudieron leer los {voc.plural}. Vuelve a cargar para reintentar.</Callout>}

      <KpiStrip columns={4}>
        <KpiStripItem label={`Costo de ${voc.plural} · 30 días`} icon={Wallet} value={pesos.format(costoMes)} detail={`${(usos ?? []).length} usos registrados`} />
        <KpiStripItem label={`${mayuscula(voc.plural)} cobrados · 30 días`} icon={Receipt} value={pesos.format(cobradoMes)} detail={`Sumados a la cuenta del ${cliente}`} tone="good" />
        <KpiStripItem label="Inventario valorizado" icon={Package} value={pesos.format(inventario)} detail={`${insumos.filter((insumo) => insumo.activo).length} ${voc.plural} activos`} />
        <KpiStripItem
          label="Por reponer"
          icon={PackageX}
          value={String(bajos.length)}
          detail={bajos.length > 0 ? bajos.slice(0, 3).map((insumo) => insumo.nombre).join(", ") : "Todo sobre el mínimo"}
          tone={bajos.length > 0 ? "warn" : "default"}
        />
      </KpiStrip>

      {masUsados.length > 0 && (
        <SectionCard title="Dónde se va el gasto" description={`Los ${voc.plural} que más costaron en los últimos 30 días.`}>
          <ul className="divide-y divide-border/70 border-t border-border">
            {masUsados.map(([id, uso]) => (
              <li key={id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={nombre.get(id) ?? voc.singular} size="sm" shape="square" />
                  <span className="truncate text-foreground">{nombre.get(id) ?? `${mayuscula(voc.singular)} eliminado`}</span>
                </span>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  {numero.format(uso.cantidad)} usados · <span className="text-foreground">{pesos.format(uso.costo)}</span>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {!error && insumos.length === 0 && (
        <SectionCard>
          <EmptyState
            icon={Package}
            title={`Todavía no hay ${voc.plural}`}
            description={`Agrega el primero con «Nuevo ${voc.singular}». Con su costo, cada atención muestra su margen y el stock baja solo al atender.`}
            className="py-8"
          />
        </SectionCard>
      )}

      {[...grupos.entries()].map(([categoria, items]) => (
        <SectionCard
          key={categoria}
          title={
            <>
              {categoria}
              <Conteo>{items.length}</Conteo>
            </>
          }
        >
          <div className="hidden h-10 grid-cols-[minmax(0,1fr)_110px_110px_90px_90px_auto_auto] items-center gap-3 border-y border-border bg-surface-raised px-5 text-xs font-medium text-muted-foreground lg:grid">
            <span>{mayuscula(voc.singular)}</span>
            <span className="text-right">Costo</span>
            <span className="text-right">Precio venta</span>
            <span className="text-right">Stock</span>
            <span className="text-right">Mínimo</span>
            <span />
            <span />
          </div>
          <div className="divide-y divide-border/70">
            {items.map((insumo) => {
              const uso = consumo.get(insumo.id);
              const bajo = insumo.stock !== null && Number(insumo.stock) <= Number(insumo.stock_minimo ?? 0);
              return (
                <ActionForm
                  key={insumo.id}
                  action={guardarInsumo}
                  success={`${insumo.nombre} guardado`}
                  className={`grid items-center gap-3 px-5 py-3 lg:grid-cols-[minmax(0,1fr)_110px_110px_90px_90px_auto_auto] ${insumo.activo ? "" : "opacity-60"}`}
                >
                  <input type="hidden" name="id" value={insumo.id} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{insumo.nombre}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>por {insumo.unidad}</span>
                      {uso && <span>· {numero.format(uso.cantidad)} usados en 30 días</span>}
                      {bajo && insumo.activo && <Badge tone="warning">Reponer</Badge>}
                      {!insumo.activo && <Badge tone="neutral">Inactivo</Badge>}
                    </div>
                  </div>
                  <label className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input
                      name="costo"
                      inputMode="numeric"
                      defaultValue={Math.round(Number(insumo.costo)).toLocaleString("es-CL")}
                      className="pl-6 text-right tabular-nums"
                      aria-label={`Costo de ${insumo.nombre}`}
                    />
                  </label>
                  <label className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input
                      name="precio_venta"
                      inputMode="numeric"
                      defaultValue={insumo.precio_venta ? Math.round(Number(insumo.precio_venta)).toLocaleString("es-CL") : ""}
                      placeholder="—"
                      className="pl-6 text-right tabular-nums"
                      aria-label={`Precio de venta de ${insumo.nombre}`}
                    />
                  </label>
                  <Input
                    name="stock"
                    inputMode="decimal"
                    defaultValue={insumo.stock === null ? "" : numero.format(Number(insumo.stock)).replace(/\./g, "")}
                    placeholder="—"
                    className={`text-right tabular-nums ${bajo && insumo.activo ? "text-warning" : ""}`}
                    aria-label={`Stock de ${insumo.nombre}`}
                  />
                  <Input
                    name="stock_minimo"
                    inputMode="decimal"
                    defaultValue={insumo.stock_minimo === null ? "" : numero.format(Number(insumo.stock_minimo)).replace(/\./g, "")}
                    placeholder="—"
                    className="text-right tabular-nums"
                    aria-label={`Stock mínimo de ${insumo.nombre}`}
                  />
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" name="cobrable" value="si" defaultChecked={insumo.cobrable} className="size-3.5 accent-[var(--primary)]" />
                      Se cobra
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="hidden" name="activo" value="no" />
                      <input type="checkbox" name="activo" value="si" defaultChecked={insumo.activo} className="size-3.5 accent-[var(--primary)]" />
                      Activo
                    </label>
                  </div>
                  <ActionSubmit size="sm" variant="secondary" pendingLabel="…">
                    Guardar
                  </ActionSubmit>
                </ActionForm>
              );
            })}
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
