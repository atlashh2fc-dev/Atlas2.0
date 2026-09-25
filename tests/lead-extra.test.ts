import assert from "node:assert/strict";
import test from "node:test";
import { leadContactPerson, leadExtraFields } from "../src/lib/lead-extra.ts";

// Formas reales de `leads.extra` en Equifax (25-09-2026).
const atlas1 = {
  atlas1: { campana: "Equifax", intentos: 1, nombre_cliente: "ESTEBAN RODRIGO FUENTES JARUFE", legacy_lead_ids: ["x"] },
  origen: "atlas1_equifax_2026_09",
  base_discado: {
    base: "vocalcom_2026_09_24",
    rubro: "ACTIVIDADES PROFESIONALES, CIENTIFICAS Y TECNICAS",
    comuna: "LAS CONDES",
    vocalcom_resultado: "Tipificacion Automatica",
    vocalcom_ultimo_intento: "2026-09-21T14:11:22+00:00",
  },
};

test("la persona de contacto sale de Atlas 1 aunque venga anidada", () => {
  assert.equal(leadContactPerson(atlas1, "CONSULTORA FUENTES SPA"), "ESTEBAN RODRIGO FUENTES JARUFE");
  assert.equal(leadContactPerson({ contact_name: "Ana Pérez" }, "Empresa SpA"), "Ana Pérez");
});

test("sin persona, o si repite la razón social, no se inventa un contacto", () => {
  assert.equal(leadContactPerson({ base_discado: { rubro: "X" } }, "MONSALVE Y COMPANIA LIMITADA"), null);
  assert.equal(leadContactPerson({ atlas1: { nombre_cliente: "Monsalve y Compañia Limitada " } }, "MONSALVE Y COMPANIA LIMITADA"), null);
  assert.equal(leadContactPerson(null, "X"), null);
});

test("los datos anidados de la base se ven con etiqueta y en hora Chile", () => {
  const fields = Object.fromEntries(leadExtraFields(atlas1));
  assert.equal(fields.Rubro, "ACTIVIDADES PROFESIONALES, CIENTIFICAS Y TECNICAS");
  assert.equal(fields.Comuna, "LAS CONDES");
  assert.equal(fields["Último resultado Vocalcom"], "Tipificacion Automatica");
  assert.match(fields["Último intento Vocalcom"], /11:11/);
  assert.equal(fields["Intentos en Atlas 1"], "1");
  // Ni datos internos de la carga ni el contacto repetido.
  for (const hidden of ["origen", "base", "campana", "legacy_lead_ids", "nombre_cliente"]) {
    assert.equal(hidden in fields, false, hidden);
  }
});

test("el primer nivel se sigue mostrando igual y respeta las exclusiones", () => {
  const fields = leadExtraFields({ monto: 1000, plan: "Pro", contact_name: "Ana", deuda: 5 }, { exclude: ["deuda"] });
  assert.deepEqual(fields, [["monto", "1000"], ["plan", "Pro"]]);
});

test("sin persona en la base se usa la que completó Bigdata, con su cargo", () => {
  const extra = {
    base_discado: { rubro: "X" },
    contacto: { nombre: "Manuela Chicharro Vargas", cargo: "Representante legal", fuente: "bigdata" },
  };
  assert.equal(leadContactPerson(extra, "EMPRESA SPA"), "Manuela Chicharro Vargas · Representante legal");
  // La persona con quien se habló en Atlas 1 manda sobre la de Bigdata.
  assert.equal(
    leadContactPerson({ ...extra, atlas1: { nombre_cliente: "Freddy Brevis" } }, "EMPRESA SPA"),
    "Freddy Brevis"
  );
  // Si Atlas 1 solo repetía la razón social, se cae a Bigdata.
  assert.equal(
    leadContactPerson({ ...extra, atlas1: { nombre_cliente: "Empresa SpA" } }, "EMPRESA SPA"),
    "Manuela Chicharro Vargas · Representante legal"
  );
  assert.equal("contacto" in Object.fromEntries(leadExtraFields(extra)), false);
});
