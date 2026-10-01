"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { buscarCuentasParaCita, buscarMascotasParaCita, type OpcionDeCita } from "@/app/actions/citas";
import { ComboboxBusqueda } from "@/components/combobox-busqueda";

/**
 * Persona y mascota de «Nueva cita», con búsqueda por nombre o RUT.
 *
 * Elegida la persona, la mascota se acota a las suyas; elegida primero la
 * mascota, la persona se completa sola con su tutor. Los campos que recibe
 * `agendarCita` siguen siendo `cuenta_id` y `mascota_id`.
 */
export function SelectorPaciente({
  etiqueta,
  cuentas,
  totalCuentas,
  mascotas,
  totalMascotas,
  esVet,
  cuentaInicial,
  mascotaInicial,
}: {
  /** «Paciente», «Tutor», «Cliente»… según la edición. */
  etiqueta: string;
  cuentas: OpcionDeCita[];
  totalCuentas: number;
  mascotas: OpcionDeCita[];
  totalMascotas: number;
  esVet: boolean;
  cuentaInicial: OpcionDeCita | null;
  mascotaInicial: OpcionDeCita | null;
}) {
  const [cuenta, setCuenta] = useState<OpcionDeCita | null>(cuentaInicial);
  const [mascota, setMascota] = useState<OpcionDeCita | null>(mascotaInicial);
  const [mascotasDeLaCuenta, setMascotasDeLaCuenta] = useState<OpcionDeCita[]>([]);

  // Si la clínica tiene más mascotas que las cargadas, las de la persona
  // elegida se piden aparte para que ninguna quede fuera de la lista.
  useEffect(() => {
    if (!esVet || !cuenta || totalMascotas <= mascotas.length) return;
    let vigente = true;
    buscarMascotasParaCita("", cuenta.value)
      .then((resultado) => {
        if (vigente) setMascotasDeLaCuenta(resultado);
      })
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [esVet, cuenta, totalMascotas, mascotas.length]);

  const opcionesMascota = useMemo(() => {
    if (!cuenta) return mascotas;
    const vistas = new Set<string>();
    return [...mascotas, ...mascotasDeLaCuenta].filter((opcion) => {
      if (opcion.cuentaId !== cuenta.value || vistas.has(opcion.value)) return false;
      vistas.add(opcion.value);
      return true;
    });
  }, [cuenta, mascotas, mascotasDeLaCuenta]);

  const buscarCuentas = useCallback((consulta: string) => buscarCuentasParaCita(consulta), []);
  const cuentaId = cuenta?.value ?? null;
  const buscarMascotas = useCallback((consulta: string) => buscarMascotasParaCita(consulta, cuentaId), [cuentaId]);

  return (
    <>
      <ComboboxBusqueda
        name="cuenta_id"
        label={etiqueta}
        opciones={cuentas}
        total={totalCuentas}
        buscarEnServidor={buscarCuentas}
        seleccion={cuenta}
        onSeleccion={(opcion) => {
          setCuenta(opcion);
          setMascotasDeLaCuenta([]);
          if (mascota && mascota.cuentaId !== opcion?.value) setMascota(null);
        }}
        placeholder={`Nombre o RUT del ${etiqueta.toLowerCase()}`}
        requerido
        mensajeRequerido={`Elige al ${etiqueta.toLowerCase()} de la lista.`}
        autoFocus
      />
      {esVet && (
        <ComboboxBusqueda
          name="mascota_id"
          label="Mascota (opcional)"
          opciones={opcionesMascota}
          // Acotada a una persona, la lista ya está completa.
          total={cuenta ? undefined : totalMascotas}
          buscarEnServidor={buscarMascotas}
          seleccion={mascota}
          onSeleccion={(opcion) => {
            setMascota(opcion);
            if (opcion?.cuentaId && opcion.cuentaId !== cuenta?.value) {
              setCuenta({ value: opcion.cuentaId, label: opcion.cuentaNombre || "Tutor de la mascota" });
            }
          }}
          opcionVacia="Sin mascota"
          placeholder={cuenta ? `Mascotas de ${cuenta.label}` : "Nombre de la mascota"}
          ayuda={cuenta && opcionesMascota.length === 0 ? `${cuenta.label} no tiene mascotas registradas.` : undefined}
        />
      )}
    </>
  );
}
