import { unstable_noStore as noStore } from "next/cache";

import { crearInsumo, guardarInsumo } from "@/app/actions/insumos";
import { CreatePanel } from "@/components/create-panel";
import { ActionForm, ActionSubmit, Badge, Field, Input, PageHeader, SectionCard, StatCard } from "@/components/ui";
import { pesos, type Insumo } from "@/lib/arancel";
import { createClient } from "@/lib/supabase/server";

/**
 * Materiales e insumos de la clínica.
 *
 * Cada material tiene su costo (para el margen), su precio si se cobra aparte
 * y su stock, que baja solo con cada atención. Arriba, lo que se gastó en los
 * últimos 30 días y lo que hay que reponer.
 */

const numero = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 });

/** Desde cuándo se mide el consumo: hace 30 días. */
function hace30Dias() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

export default async function InsumosPage() {
  noStore();
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
        title="Materiales e insumos"
        description="Lo que usa la clínica: el costo alimenta el margen de cada atención, los cobrables se suman a la cuenta y el stock baja solo al atender."
        actions={
          <CreatePanel
            label="Nuevo material"
            title="Nuevo material"
            description="Queda disponible para las recetas y las atenciones."
            action={crearInsumo}
            submitLabel="Agregar material"
            successLabel="Material agregado"
          >
            <Field label="Nombre">
              <Input name="nombre" required placeholder="Resina bulk fill" data-autofocus />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Categoría">
                <Input name="categoria" placeholder="Operatoria" />
              </Field>
              <Field label="Unidad">
                <Input name="unidad" placeholder="unidad, ml, dosis" />
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
              <input type="checkbox" name="cobrable" value="si" className="size-4 accent-[var(--primary)]" /> Se cobra aparte al paciente
            </label>
          </CreatePanel>
        }
      />

      {error && <p className="text-sm text-danger">No se pudieron leer los materiales. Vuelve a cargar para reintentar.</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Costo de materiales · 30 días" value={pesos.format(costoMes)} hint={`${(usos ?? []).length} usos registrados`} />
        <StatCard label="Materiales cobrados · 30 días" value={pesos.format(cobradoMes)} hint="Sumados a la cuenta del paciente" tone="good" />
        <StatCard label="Inventario valorizado" value={pesos.format(inventario)} hint={`${insumos.filter((insumo) => insumo.activo).length} materiales activos`} />
        <StatCard
          label="Por reponer"
          value={bajos.length}
          hint={bajos.length > 0 ? bajos.slice(0, 3).map((insumo) => insumo.nombre).join(", ") : "Todo sobre el mínimo"}
          tone={bajos.length > 0 ? "warn" : "default"}
        />
      </div>

      {masUsados.length > 0 && (
        <SectionCard title="Dónde se va el gasto" description="Los materiales que más costaron en los últimos 30 días.">
          <ul className="divide-y divide-border">
            {masUsados.map(([id, uso]) => (
              <li key={id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="truncate text-foreground">{nombre.get(id) ?? "Material eliminado"}</span>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  {numero.format(uso.cantidad)} usados · <span className="text-foreground">{pesos.format(uso.costo)}</span>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {[...grupos.entries()].map(([categoria, items]) => (
        <SectionCard key={categoria} title={categoria} description={`${items.length} ${items.length === 1 ? "material" : "materiales"}`}>
          <div className="hidden grid-cols-[minmax(0,1fr)_110px_110px_90px_90px_auto_auto] gap-3 border-b border-border px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
            <span>Material</span>
            <span className="text-right">Costo</span>
            <span className="text-right">Precio venta</span>
            <span className="text-right">Stock</span>
            <span className="text-right">Mínimo</span>
            <span />
            <span />
          </div>
          <div className="divide-y divide-border">
            {items.map((insumo) => {
              const uso = consumo.get(insumo.id);
              const bajo = insumo.stock !== null && Number(insumo.stock) <= Number(insumo.stock_minimo ?? 0);
              return (
                <ActionForm
                  key={insumo.id}
                  action={guardarInsumo}
                  success={`${insumo.nombre} guardado`}
                  className={`grid items-center gap-3 px-4 py-2.5 lg:grid-cols-[minmax(0,1fr)_110px_110px_90px_90px_auto_auto] ${insumo.activo ? "" : "opacity-60"}`}
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
