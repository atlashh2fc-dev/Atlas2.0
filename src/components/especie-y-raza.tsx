"use client";

import { useState } from "react";

import { Field, Input, Select } from "@/components/ui";

const OTRA = "__otra__";

/**
 * Especie y raza al crear la mascota. Perros y gatos eligen entre las razas que
 * tienen modelo 3D, así la ficha nace con su animal; si no está, se escribe y
 * se ve como mestizo. Otras especies escriben la raza libre.
 */
export function EspecieYRaza({ razas }: { razas: Record<"Perro" | "Gato", { nombre: string; peso: string }[]> }) {
  const [especie, setEspecie] = useState<string>("Perro");
  const [raza, setRaza] = useState<string>("Mestizo");
  const lista = especie === "Perro" || especie === "Gato" ? razas[especie] : null;
  const escribe = !lista || raza === OTRA;

  return (
    <>
      <Field label="Especie">
        <Select
          name="especie"
          value={especie}
          onChange={(event) => {
            setEspecie(event.target.value);
            setRaza("Mestizo");
          }}
        >
          <option>Perro</option>
          <option>Gato</option>
          <option>Otro</option>
        </Select>
      </Field>
      {lista ? (
        <Field label={<>Raza <span className="text-muted-foreground/70">· las de la lista tienen su modelo 3D</span></>}>
          <Select value={raza} onChange={(event) => setRaza(event.target.value)} name={escribe ? undefined : "raza"}>
            {lista.map((item) => (
              <option key={item.nombre} value={item.nombre}>
                {item.nombre} · {item.peso}
              </option>
            ))}
            <option value={OTRA}>Otra raza…</option>
          </Select>
        </Field>
      ) : null}
      {escribe && (
        <Field label={lista ? "¿Cuál?" : "Raza"}>
          <Input name="raza" placeholder={lista ? "Se verá como mestizo en 3D" : "Conejo, hurón, ave…"} />
        </Field>
      )}
    </>
  );
}
