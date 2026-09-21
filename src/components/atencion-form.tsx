"use client";

import { useMemo, useState } from "react";
import { Package, Plus, Stethoscope, X } from "lucide-react";

import { registrarAtencion } from "@/app/actions/atenciones";
import { ActionForm, ActionSubmit, Field, Input, Select } from "@/components/ui";
import { useInsumos } from "@/components/insumos-context";
import {
  pesos,
  porCategoria,
  totalesMateriales,
  type AplicaA,
  type MaterialElegido,
  type Procedimiento,
} from "@/lib/arancel";
import { INFO_ESTADO, type EstadoPieza } from "@/lib/odontograma";

const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

/**
 * Registrar una atención: se elige el procedimiento del arancel, el precio
 * viene de ahí (y se puede ajustar), y se dice quién la hizo y si ya se pagó.
 * En una pieza, si el procedimiento cambia el odontograma, lo actualiza.
 *
 * Los materiales parten de la receta del procedimiento y se ajustan a lo que
 * de verdad se usó: el costo sirve para el margen y los cobrables (un injerto,
 * una placa, un collar) se suman al cobro.
 */
export function AtencionForm({
  cuentaId,
  arancel,
  aplica,
  pieza,
  superficies,
  mascotaId,
  region,
  profesionales,
  onGuardada,
  titulo,
}: {
  cuentaId: string;
  arancel: Procedimiento[];
  /** Qué procedimientos se ofrecen: los de la pieza, los de toda la boca, los de la mascota... */
  aplica: AplicaA[];
  pieza?: number;
  /** Superficies elegidas en la cruz (para los procedimientos por superficie). */
  superficies?: string[];
  mascotaId?: string;
  region?: string | null;
  profesionales: string[];
  onGuardada?: () => void;
  titulo?: string;
}) {
  const disponibles = useMemo(
    () => arancel.filter((procedimiento) => procedimiento.active && aplica.includes(procedimiento.aplica_a)),
    [arancel, aplica],
  );
  const [elegido, setElegido] = useState<string>(disponibles[0]?.id ?? "");
  const procedimiento = disponibles.find((item) => item.id === elegido) ?? null;
  const [precio, setPrecio] = useState<string>(
    disponibles[0]?.one_time_price ? Math.round(Number(disponibles[0].one_time_price)).toLocaleString("es-CL") : "",
  );
  const { lista: catalogo, porId } = useInsumos();
  const deReceta = (item: Procedimiento | undefined): MaterialElegido[] =>
    (item?.receta ?? []).filter((linea) => porId.has(linea.insumo_id)).map((linea) => ({ ...linea, cantidad: Number(linea.cantidad), cobrar: true }));
  const [materiales, setMateriales] = useState<MaterialElegido[]>(() => deReceta(disponibles[0]));
  const { costo, cobro } = totalesMateriales(materiales, porId);
  const precioNumero = Number(precio.replace(/[^\d]/g, "")) || 0;
  const total = precioNumero + cobro;
  const margen = total - costo;
  const sinUsar = catalogo.filter((insumo) => insumo.activo && !materiales.some((material) => material.insumo_id === insumo.id));
  const cambiarMaterial = (id: string, cambio: Partial<MaterialElegido>) =>
    setMateriales((actuales) => actuales.map((material) => (material.insumo_id === id ? { ...material, ...cambio } : material)));

  if (disponibles.length === 0) {
    return <p className="text-sm text-muted-foreground">No hay procedimientos para esto en el arancel. Agrégalos en Procedimientos y precios.</p>;
  }

  const resultado = procedimiento?.resultado_odontograma as EstadoPieza | null | undefined;
  const faltanSuperficies = procedimiento?.aplica_a === "superficie" && (superficies?.length ?? 0) === 0;

  return (
    <ActionForm action={registrarAtencion} success="Atención registrada" onSuccess={onGuardada} className="space-y-3">
      {titulo && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>}
      <input type="hidden" name="cuenta_id" value={cuentaId} />
      <input type="hidden" name="producto_id" value={elegido} />
      {pieza !== undefined && <input type="hidden" name="pieza" value={pieza} />}
      {mascotaId && <input type="hidden" name="mascota_id" value={mascotaId} />}
      {region && <input type="hidden" name="region" value={region} />}
      {(superficies ?? []).map((superficie) => (
        <input key={superficie} type="hidden" name="superficies" value={superficie} />
      ))}

      <Field label="Procedimiento">
        <Select
          value={elegido}
          onChange={(event) => {
            setElegido(event.target.value);
            const nuevo = disponibles.find((item) => item.id === event.target.value);
            setPrecio(nuevo?.one_time_price ? Math.round(Number(nuevo.one_time_price)).toLocaleString("es-CL") : "");
            setMateriales(deReceta(nuevo));
          }}
        >
          {porCategoria(disponibles).map(([categoria, items]) => (
            <optgroup key={categoria} label={categoria}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.one_time_price ? ` · ${pesos.format(Number(item.one_time_price))}` : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </Field>

      {procedimiento && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {procedimiento.duracion_min ? <span>{procedimiento.duracion_min} min</span> : null}
          {procedimiento.es_urgencia && <span className="font-medium text-danger">Urgencia</span>}
          {resultado && pieza !== undefined && (
            <span className="flex items-center gap-1">
              Deja la pieza {pieza} con
              <span className="size-2 rounded-full" style={{ background: INFO_ESTADO[resultado].color }} />
              {INFO_ESTADO[resultado].label.toLowerCase()}
            </span>
          )}
          {faltanSuperficies && <span className="font-medium text-warning">Marca las superficies en la cruz de arriba</span>}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Precio">
          <Input name="precio" inputMode="numeric" value={precio} onChange={(event) => setPrecio(event.target.value)} placeholder="0" />
        </Field>
        <Field label="Fecha">
          <Input name="fecha" type="date" defaultValue={hoy()} />
        </Field>
      </div>
      {catalogo.length > 0 && (
        <div className="rounded-lg border border-border">
          <input type="hidden" name="insumos" value={JSON.stringify(materiales.filter((material) => material.cantidad > 0))} />
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Package size={13} aria-hidden="true" /> Materiales usados
            </p>
            {sinUsar.length > 0 && (
              <select
                aria-label="Agregar material"
                value=""
                onChange={(event) => {
                  const id = event.target.value;
                  if (id) setMateriales((actuales) => [...actuales, { insumo_id: id, cantidad: 1, cobrar: true }]);
                }}
                className="max-w-[55%] rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground"
              >
                <option value="">+ Agregar material</option>
                {[...new Set(sinUsar.map((insumo) => insumo.categoria ?? "Otros"))].map((categoria) => (
                  <optgroup key={categoria} label={categoria}>
                    {sinUsar
                      .filter((insumo) => (insumo.categoria ?? "Otros") === categoria)
                      .map((insumo) => (
                        <option key={insumo.id} value={insumo.id}>
                          {insumo.nombre}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>
          {materiales.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              <Plus size={12} className="mr-1 inline" aria-hidden="true" />
              Este procedimiento no tiene receta. Agrega lo que usaste.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {materiales.map((material) => {
                const insumo = porId.get(material.insumo_id);
                if (!insumo) return null;
                return (
                  <li key={material.insumo_id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{insumo.nombre}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {pesos.format(Number(insumo.costo))} / {insumo.unidad}
                        {insumo.cobrable && insumo.precio_venta ? ` · se cobra ${pesos.format(Number(insumo.precio_venta))}` : ""}
                        {insumo.stock !== null && Number(insumo.stock) <= Number(insumo.stock_minimo ?? 0) ? " · stock bajo" : ""}
                      </span>
                    </span>
                    {insumo.cobrable && (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Cobrar este material aparte">
                        <input
                          type="checkbox"
                          checked={material.cobrar}
                          onChange={(event) => cambiarMaterial(material.insumo_id, { cobrar: event.target.checked })}
                          className="size-3.5 accent-[var(--primary)]"
                        />
                        Cobrar
                      </label>
                    )}
                    <input
                      aria-label={`Cantidad de ${insumo.nombre}`}
                      type="number"
                      min={0}
                      step="0.5"
                      value={material.cantidad}
                      onChange={(event) => cambiarMaterial(material.insumo_id, { cantidad: Number(event.target.value) })}
                      className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-right text-sm tabular-nums text-foreground"
                    />
                    <button
                      type="button"
                      aria-label={`Quitar ${insumo.nombre}`}
                      onClick={() => setMateriales((actuales) => actuales.filter((item) => item.insumo_id !== material.insumo_id))}
                      className="rounded p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-border bg-surface-muted/50 px-3 py-2 text-xs">
            <dt className="text-muted-foreground">Procedimiento</dt>
            <dd className="text-right tabular-nums text-foreground">{pesos.format(precioNumero)}</dd>
            <dt className="text-muted-foreground">Materiales cobrados</dt>
            <dd className="text-right tabular-nums text-foreground">{pesos.format(cobro)}</dd>
            <dt className="font-semibold text-foreground">Total a cobrar</dt>
            <dd className="text-right font-semibold tabular-nums text-foreground">{pesos.format(total)}</dd>
            <dt className="text-muted-foreground">Costo de materiales</dt>
            <dd className="text-right tabular-nums text-muted-foreground">{pesos.format(costo)}</dd>
            <dt className="text-muted-foreground">Margen</dt>
            <dd className={`text-right tabular-nums ${margen < 0 ? "text-danger" : "text-success"}`}>
              {pesos.format(margen)}
              {total > 0 ? ` · ${Math.round((margen / total) * 100)}%` : ""}
            </dd>
          </dl>
        </div>
      )}

      <Field label="Profesional">
        <Select name="profesional" defaultValue={profesionales[0] ?? ""}>
          <option value="">Sin indicar</option>
          {profesionales.map((profesional) => (
            <option key={profesional}>{profesional}</option>
          ))}
        </Select>
      </Field>
      <Field label="Nota">
        <Input name="nota" placeholder="Anestesia local, paciente tolera bien" />
      </Field>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="pagado" value="si" className="size-4 accent-[var(--primary)]" /> Pagado
        </label>
        {resultado && pieza !== undefined && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              defaultChecked
              onChange={(event) => {
                const oculto = event.currentTarget.form?.querySelector<HTMLInputElement>('input[name="actualizar_odontograma"]');
                if (oculto) oculto.value = event.currentTarget.checked ? "si" : "no";
              }}
              className="size-4 accent-[var(--primary)]"
            />
            Actualizar odontograma
            <input type="hidden" name="actualizar_odontograma" defaultValue="si" />
          </label>
        )}
      </div>
      <ActionSubmit className="w-full" pendingLabel="Registrando…" disabled={faltanSuperficies}>
        <Stethoscope size={14} aria-hidden="true" /> Registrar atención
      </ActionSubmit>
    </ActionForm>
  );
}
