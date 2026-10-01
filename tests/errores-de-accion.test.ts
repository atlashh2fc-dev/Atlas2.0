import assert from "node:assert/strict";
import test from "node:test";
import { coincide } from "../src/lib/busqueda-tolerante.ts";
import { mensajeDeError } from "../src/lib/errores-de-accion.ts";

const silencio = () => {};

test("los errores de la base llegan al toast como frase con siguiente paso", (t) => {
  t.mock.method(console, "error", silencio);
  assert.match(
    mensajeDeError({ code: "23505", message: 'duplicate key value violates unique constraint "x"', details: "Key (organization_id, normalized_rut)=(a, 1) already exists." }),
    /^Ya existe un registro con ese RUT/,
  );
  assert.match(mensajeDeError({ code: "42501", message: "new row violates row-level security policy" }), /^No tienes permiso/);
  assert.match(mensajeDeError({ code: "PGRST301", message: "JWT expired" }), /^Tu sesión venció/);
  assert.match(mensajeDeError({ code: "57014", message: "canceling statement due to statement timeout" }), /tardó demasiado/);
  assert.match(mensajeDeError({ code: "", message: "TypeError: fetch failed" }), /No pudimos conectar/);
  assert.match(mensajeDeError({ code: "23503", message: "update or delete on table violates foreign key" }), /No se puede borrar/);
  assert.equal(mensajeDeError({ code: "42883", message: "function foo() does not exist" }, "No se pudo guardar."), "No se pudo guardar.");
});

test("lo que la base ya dice en español para la pantalla pasa intacto", (t) => {
  t.mock.method(console, "error", silencio);
  const pendiente = "Tienes una gestión pendiente de tipificación. Ciérrala antes de llamar.";
  assert.equal(mensajeDeError({ code: "P0001", message: pendiente }), pendiente);
  assert.match(mensajeDeError({ code: "P0001", message: "not_authorized" }), /^No tienes permiso/);
  assert.match(mensajeDeError({ code: "P0001", message: "No autenticado." }), /^Tu sesión venció/);
});

test("el selector de citas busca por nombre sin tildes y por RUT sin puntos ni guion", () => {
  const opcion = { value: "1", label: "José Pérez Soto", detalle: "12.345.678-5" };
  assert.ok(coincide(opcion, "jose perez"));
  assert.ok(coincide(opcion, "12345678"));
  assert.ok(coincide(opcion, "12.345.678-5"));
  assert.ok(!coincide(opcion, "maria"));
});
