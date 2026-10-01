"use client";

import { useState } from "react";

import { Field, Input } from "@/components/ui";

/** «Clínica Los Andes» → «clinica-los-andes». */
function claveDesde(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Nombre y clave de una empresa nueva. La clave se arma sola desde el nombre
 * (el sistema absorbe la regla de formato) y se puede corregir antes de crear,
 * porque después ya no cambia.
 */
export function CamposNuevaEmpresa() {
  const [nombre, setNombre] = useState("");
  const [clave, setClave] = useState("");
  const [editada, setEditada] = useState(false);
  const valor = editada ? clave : claveDesde(nombre);

  return (
    <>
      <Field label="Nombre">
        <Input
          name="nombre"
          required
          placeholder="Clínica Los Andes"
          data-autofocus
          value={nombre}
          onChange={(event) => setNombre(event.target.value)}
        />
      </Field>
      <Field label="Clave">
        <Input
          name="slug"
          required
          placeholder="clinica-los-andes"
          pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]"
          value={valor}
          onChange={(event) => {
            setEditada(true);
            setClave(claveDesde(event.target.value) || event.target.value.toLowerCase());
          }}
        />
        <span className="text-xs text-muted-foreground">
          Se arma sola desde el nombre. Se usa en integraciones y no se cambia después.
        </span>
      </Field>
    </>
  );
}
