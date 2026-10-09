"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { REGIONES } from "@/lib/bigdata-ficha";
import { isValidRut } from "@/lib/rut";
import { CAMPO_LABEL, type DatosCliente } from "@/lib/terreno";
import { BOTON_PRIMARIO, CampoTerreno, InputTerreno, SelectTerreno } from "./campos";

type Props = {
  inicial: DatosCliente;
  /** El RUT ya se buscó: no se edita aquí para no crear otro distinto. */
  rutBloqueado?: boolean;
  /** Campos que vinieron de Atlas o Bigdata, para que el vendedor los revise. */
  completados?: (keyof DatosCliente)[];
  submitLabel: string;
  onSubmit: (datos: DatosCliente) => Promise<{ ok: boolean; message?: string }>;
};

/**
 * Datos del comercio en tres bloques cortos (comercio, contacto, ubicación).
 * Solo el nombre es obligatorio: en la calle se guarda lo que se tiene y se
 * completa en la siguiente visita.
 */
export function DatosClienteForm({ inicial, rutBloqueado, completados = [], submitLabel, onSubmit }: Props) {
  const [datos, setDatos] = useState<DatosCliente>(inicial);
  const [error, setError] = useState<string | null>(null);
  const [tocado, setTocado] = useState<Partial<Record<keyof DatosCliente, boolean>>>({});
  const [pending, startTransition] = useTransition();

  const set = (campo: keyof DatosCliente) => (event: { target: { value: string } }) =>
    setDatos((prev) => ({ ...prev, [campo]: event.target.value }));
  const blur = (campo: keyof DatosCliente) => () => setTocado((prev) => ({ ...prev, [campo]: true }));

  const errorNombre = tocado.full_name && !datos.full_name.trim() ? "Escribe el nombre del comercio o de la persona." : null;
  const errorRut = tocado.rut && datos.rut.trim() && !isValidRut(datos.rut) ? "El RUT no es válido: revisa el dígito verificador." : null;
  const errorCorreo =
    tocado.email && datos.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email.trim()) ? "Revisa el correo." : null;

  const hint = (campo: keyof DatosCliente) => (completados.includes(campo) ? "Completado automáticamente: revísalo." : undefined);

  function enviar(event: React.FormEvent) {
    event.preventDefault();
    setTocado({ full_name: true, rut: true, email: true });
    if (!datos.full_name.trim()) return setError("Escribe el nombre del comercio o de la persona.");
    if (datos.rut.trim() && !isValidRut(datos.rut)) return setError("El RUT no es válido.");
    setError(null);
    startTransition(async () => {
      const result = await onSubmit(datos);
      if (!result.ok) setError(result.message ?? "No se pudo guardar.");
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-6" noValidate>
      <fieldset className="space-y-3.5">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Comercio</legend>
        <CampoTerreno label={`${CAMPO_LABEL.full_name} *`} error={errorNombre} hint={hint("full_name")}>
          <InputTerreno
            value={datos.full_name}
            onChange={set("full_name")}
            onBlur={blur("full_name")}
            autoComplete="organization"
            placeholder="Ej.: Minimarket Don Pedro"
            aria-invalid={Boolean(errorNombre)}
          />
        </CampoTerreno>
        <CampoTerreno label={CAMPO_LABEL.rut} error={errorRut} hint={rutBloqueado ? "Buscado al inicio." : "Opcional. Con RUT evitamos duplicados."}>
          <InputTerreno
            value={datos.rut}
            onChange={set("rut")}
            onBlur={blur("rut")}
            readOnly={rutBloqueado}
            inputMode="text"
            autoCapitalize="characters"
            placeholder="12.345.678-9"
            aria-invalid={Boolean(errorRut)}
            className={rutBloqueado ? "bg-surface-muted" : undefined}
          />
        </CampoTerreno>
        <CampoTerreno label={CAMPO_LABEL.rubro} hint={hint("rubro")}>
          <InputTerreno value={datos.rubro} onChange={set("rubro")} placeholder="Ej.: Almacén, peluquería, food truck" />
        </CampoTerreno>
      </fieldset>

      <fieldset className="space-y-3.5">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contacto</legend>
        <CampoTerreno label={CAMPO_LABEL.nombre_contacto} hint={hint("nombre_contacto")}>
          <InputTerreno value={datos.nombre_contacto} onChange={set("nombre_contacto")} autoComplete="name" placeholder="Quién decide la compra" />
        </CampoTerreno>
        <CampoTerreno label={CAMPO_LABEL.phone} hint={hint("phone") ?? "Con o sin +56, como venga."}>
          <InputTerreno value={datos.phone} onChange={set("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder="+56 9 1234 5678" />
        </CampoTerreno>
        <CampoTerreno label={CAMPO_LABEL.email} error={errorCorreo} hint={hint("email")}>
          <InputTerreno
            value={datos.email}
            onChange={set("email")}
            onBlur={blur("email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            placeholder="correo@comercio.cl"
            aria-invalid={Boolean(errorCorreo)}
          />
        </CampoTerreno>
      </fieldset>

      <fieldset className="space-y-3.5">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ubicación</legend>
        <CampoTerreno label={CAMPO_LABEL.direccion} hint={hint("direccion")}>
          <InputTerreno value={datos.direccion} onChange={set("direccion")} autoComplete="street-address" placeholder="Calle y número" />
        </CampoTerreno>
        <CampoTerreno label={CAMPO_LABEL.comuna} hint={hint("comuna")}>
          <InputTerreno value={datos.comuna} onChange={set("comuna")} autoComplete="address-level2" />
        </CampoTerreno>
        <CampoTerreno label={CAMPO_LABEL.region} hint={hint("region")}>
          <SelectTerreno value={datos.region} onChange={set("region")}>
            <option value="">Elegir región</option>
            {REGIONES.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </SelectTerreno>
        </CampoTerreno>
      </fieldset>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className={BOTON_PRIMARIO}>
        {pending && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
        {pending ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}
