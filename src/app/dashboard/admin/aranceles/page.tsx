import { unstable_noStore as noStore } from "next/cache";

import { crearProcedimiento, guardarProcedimiento } from "@/app/actions/atenciones";
import { CreatePanel } from "@/components/create-panel";
import { ActionForm, ActionSubmit, Badge, Field, Input, PageHeader, SectionCard, Select } from "@/components/ui";
import { InsumosProvider } from "@/components/insumos-context";
import { RecetaEditor } from "@/components/receta-editor";
import { CATEGORIAS, ETIQUETA_APLICA_A, porCategoria, type Insumo, type Procedimiento } from "@/lib/arancel";
import { contextoDeMiEmpresa } from "@/lib/modules.server";
import { ESTADOS, INFO_ESTADO } from "@/lib/odontograma";
import { createClient } from "@/lib/supabase/server";

/**
 * Procedimientos y precios de la clínica.
 *
 * Es la lista de la que salen los presupuestos y las atenciones: cambiar un
 * precio acá cambia lo que se propone la próxima vez, no lo ya cobrado. En
 * Dental cada procedimiento dice además qué deja en el odontograma. Bajo cada
 * uno, su receta de materiales con el costo y el margen que deja.
 */
export default async function ArancelesPage() {
  noStore();
  const { edicion } = await contextoDeMiEmpresa();
  const clinica = edicion === "vet" ? "vet" : "dental";
  const supabase = await createClient();
  const [{ data, error }, { data: insumosData }] = await Promise.all([
    supabase
      .from("sales_products")
      .select("id, code, name, one_time_price, categoria, duracion_min, es_urgencia, aplica_a, resultado_odontograma, orden, active, receta:procedimiento_insumos(insumo_id, cantidad)")
      .order("orden")
      .order("name"),
    supabase
      .from("insumos")
      .select("id, codigo, nombre, categoria, unidad, costo, precio_venta, cobrable, stock, stock_minimo, activo")
      .order("categoria")
      .order("nombre"),
  ]);

  const procedimientos = (data ?? []) as Procedimiento[];
  const grupos = porCategoria(procedimientos);
  const aplicables = clinica === "vet" ? (["mascota", "region"] as const) : (["boca", "pieza", "superficie"] as const);

  return (
    <InsumosProvider insumos={(insumosData ?? []) as unknown as Insumo[]}>
    <div className="space-y-5">
      <PageHeader
        title="Procedimientos y precios"
        description={`El arancel de la clínica: de acá salen los presupuestos y las atenciones. ${procedimientos.length} procedimientos en ${grupos.length} categorías.`}
        actions={
          <CreatePanel
            label="Nuevo procedimiento"
            title="Nuevo procedimiento"
            description="Queda disponible de inmediato para presupuestos y atenciones."
            action={crearProcedimiento}
            submitLabel="Agregar al arancel"
            successLabel="Procedimiento agregado"
          >
            <Field label="Nombre">
              <Input name="nombre" required placeholder={clinica === "vet" ? "Ecografía cardíaca" : "Carilla de resina"} data-autofocus />
            </Field>
            <Field label="Categoría">
              <Select name="categoria" defaultValue={CATEGORIAS[clinica][0]}>
                {CATEGORIAS[clinica].map((categoria) => (
                  <option key={categoria}>{categoria}</option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Precio (CLP)">
                <Input name="precio" inputMode="numeric" placeholder="45000" />
              </Field>
              <Field label="Duración (min)">
                <Input name="duracion" inputMode="numeric" placeholder="40" />
              </Field>
            </div>
            <Field label="Se aplica a">
              <Select name="aplica_a" defaultValue={aplicables[0]}>
                {aplicables.map((aplica) => (
                  <option key={aplica} value={aplica}>
                    {ETIQUETA_APLICA_A[aplica]}
                  </option>
                ))}
              </Select>
            </Field>
            {clinica === "dental" && (
              <Field label="Qué deja en el odontograma">
                <Select name="resultado" defaultValue="">
                  <option value="">No cambia el odontograma</option>
                  {ESTADOS.filter((estado) => estado !== "sano").map((estado) => (
                    <option key={estado} value={estado}>
                      {INFO_ESTADO[estado].label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="urgencia" value="si" className="size-4 accent-[var(--primary)]" /> Es una urgencia
            </label>
          </CreatePanel>
        }
      />

      {error && <p className="text-sm text-danger">No se pudo leer el arancel. Vuelve a cargar para reintentar.</p>}

      {grupos.map(([categoria, items]) => (
        <SectionCard key={categoria} title={categoria} description={`${items.length} ${items.length === 1 ? "procedimiento" : "procedimientos"}`}>
          <div className="divide-y divide-border">
            {items.map((procedimiento) => (
              <div key={procedimiento.id}>
              <ActionForm
                action={guardarProcedimiento}
                success={`${procedimiento.name} guardado`}
                className={`grid items-center gap-3 px-4 pb-1 pt-2.5 sm:grid-cols-[minmax(0,1fr)_130px_90px_auto_auto] ${procedimiento.active ? "" : "opacity-60"}`}
              >
                <input type="hidden" name="id" value={procedimiento.id} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{procedimiento.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{ETIQUETA_APLICA_A[procedimiento.aplica_a]}</span>
                    {procedimiento.resultado_odontograma && (
                      <span className="flex items-center gap-1">
                        · deja
                        <span
                          className="size-2 rounded-full"
                          style={{ background: INFO_ESTADO[procedimiento.resultado_odontograma as keyof typeof INFO_ESTADO]?.color }}
                        />
                        {INFO_ESTADO[procedimiento.resultado_odontograma as keyof typeof INFO_ESTADO]?.label.toLowerCase()}
                      </span>
                    )}
                    {procedimiento.es_urgencia && <Badge tone="danger">Urgencia</Badge>}
                    {!procedimiento.active && <Badge tone="neutral">Inactivo</Badge>}
                  </div>
                </div>
                <label className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    name="precio"
                    inputMode="numeric"
                    defaultValue={procedimiento.one_time_price ? Math.round(Number(procedimiento.one_time_price)).toLocaleString("es-CL") : ""}
                    placeholder="Sin precio"
                    className="pl-6 text-right tabular-nums"
                    aria-label={`Precio de ${procedimiento.name}`}
                  />
                </label>
                <label className="relative">
                  <Input
                    name="duracion"
                    inputMode="numeric"
                    defaultValue={procedimiento.duracion_min ?? ""}
                    placeholder="min"
                    className="pr-9 text-right tabular-nums"
                    aria-label={`Duración de ${procedimiento.name}`}
                  />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">min</span>
                </label>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" name="urgencia" value="si" defaultChecked={procedimiento.es_urgencia} className="size-3.5 accent-[var(--primary)]" />
                    Urgencia
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="hidden" name="activo" value="no" />
                    <input type="checkbox" name="activo" value="si" defaultChecked={procedimiento.active} className="size-3.5 accent-[var(--primary)]" />
                    Activo
                  </label>
                </div>
                <ActionSubmit size="sm" variant="secondary" pendingLabel="…">
                  Guardar
                </ActionSubmit>
              </ActionForm>
              <RecetaEditor productoId={procedimiento.id} receta={procedimiento.receta ?? []} precio={procedimiento.one_time_price} />
              </div>
            ))}
          </div>
        </SectionCard>
      ))}
    </div>
    </InsumosProvider>
  );
}
