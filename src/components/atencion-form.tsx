"use client";

import { useMemo, useState } from "react";
import { Stethoscope } from "lucide-react";

import { registrarAtencion } from "@/app/actions/atenciones";
import { ActionForm, ActionSubmit, Field, Input, Select } from "@/components/ui";
import { pesos, porCategoria, type AplicaA, type Procedimiento } from "@/lib/arancel";
import { INFO_ESTADO, type EstadoPieza } from "@/lib/odontograma";

const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

/**
 * Registrar una atención: se elige el procedimiento del arancel, el precio
 * viene de ahí (y se puede ajustar), y se dice quién la hizo y si ya se pagó.
 * En una pieza, si el procedimiento cambia el odontograma, lo actualiza.
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
