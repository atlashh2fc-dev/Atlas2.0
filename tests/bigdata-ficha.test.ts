import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_FICHA_FIELDS,
  bigdataPhone,
  fichaToFields,
  mergeFichaFields,
  officialRegion,
  parseBigdataFicha,
} from "../src/lib/bigdata-ficha.ts";

// Forma real de Bigdata para 76.150.794-K (25-09-2026).
const respuesta = {
  contract: "bigdata.ficha_rut.v1",
  found: true,
  rutid: "076150794K",
  tipo: "empresa",
  nombre: "FUNERARIA ALMENDRAS Y COMPANIA LIMITADA",
  region: "XIII REGION METROPOLITANA",
  comuna: "QUINTA NORMAL",
  direccion: null,
  rubro: "OTRAS ACTIVIDADES DE SERVICIOS",
  email: null,
  contacto: null,
  telefonos: [
    { telefono: "227721528", nombre: "FUNERARIA ALMENDRAS Y COMPANIA LIMITADA", cargo: null, es_empresa: true },
    { telefono: "+56227721528", nombre: "FUNERARIA ALMENDRAS Y COMPANIA LIMITADA", es_empresa: true },
    { telefono: "982316427", nombre: "JORGE ARNOLDO ALMENDRAS SALAZAR", cargo: null, es_empresa: false },
    { telefono: "962303444", nombre: "YERENIA MILLARAY ALMENDRAS ALVAREZ", es_empresa: false },
    { telefono: "123", nombre: "basura" },
  ],
  senales: { cliente_equifax: false, activa_sii: true, no_contactar: false },
};

test("la región de Bigdata se traduce al nombre oficial", () => {
  assert.equal(officialRegion("XIII REGION METROPOLITANA"), "Metropolitana de Santiago");
  assert.equal(officialRegion("DEL BIOBIO"), "Biobío");
  assert.equal(officialRegion("VIII REGION"), "Biobío");
  assert.equal(officialRegion("XIV REGION DE LOS RIOS"), "Los Ríos");
  assert.equal(officialRegion("X REGION DE LOS LAGOS"), "Los Lagos");
  assert.equal(officialRegion("REGION DEL LIBERTADOR B. O'HIGGINS"), "Libertador General Bernardo O'Higgins");
  assert.equal(officialRegion("V"), "Valparaíso");
  assert.equal(officialRegion("desconocida"), null);
  assert.equal(officialRegion(null), null);
});

test("los teléfonos quedan en +56, sin repetidos ni basura", () => {
  assert.equal(bigdataPhone("227721528"), "+56227721528");
  assert.equal(bigdataPhone("+56 9 6230 3444"), "+56962303444");
  assert.equal(bigdataPhone("123"), null);
  const ficha = parseBigdataFicha(respuesta);
  assert.deepEqual(ficha?.telefonos.map((item) => item.telefono), ["+56227721528", "+56982316427", "+56962303444"]);
});

test("la ficha propone los campos en el formato del formulario", () => {
  const ficha = parseBigdataFicha(respuesta);
  assert.ok(ficha);
  assert.deepEqual(fichaToFields(ficha), {
    full_name: "Funeraria Almendras y Compania Limitada",
    contact_name: "",
    phone: "+56227721528",
    phone_alt: "+56982316427",
    email: "",
    region: "Metropolitana de Santiago",
    comuna: "Quinta Normal",
    direccion: "",
    rubro: "Otras actividades de servicios",
  });
});

test("si el mejor número es de una persona, esa es con quien preguntar", () => {
  const ficha = parseBigdataFicha({
    ...respuesta,
    telefonos: [{ telefono: "962303444", nombre: "YERENIA MILLARAY ALMENDRAS ALVAREZ", es_empresa: false }],
  });
  assert.equal(ficha && fichaToFields(ficha).contact_name, "Yerenia Millaray Almendras Alvarez");
  const conContacto = parseBigdataFicha({ ...respuesta, contacto: { nombre: "ANA PEREZ", cargo: "Gerente" } });
  assert.equal(conContacto && fichaToFields(conContacto).contact_name, "Ana Perez");
});

test("sin ficha o con otro contrato no se inventa nada", () => {
  assert.equal(parseBigdataFicha({ found: false }), null);
  assert.equal(parseBigdataFicha({ ...respuesta, contract: "otro.v9" }), null);
  assert.equal(parseBigdataFicha(null), null);
});

test("Bigdata rellena lo vacío y no pisa lo que el supervisor escribió", () => {
  const ficha = parseBigdataFicha(respuesta);
  assert.ok(ficha);
  const current = { ...EMPTY_FICHA_FIELDS, full_name: "Funeraria Almendras", phone: "+56911112222" };
  const { fields, filled } = mergeFichaFields(current, fichaToFields(ficha));
  assert.equal(fields.full_name, "Funeraria Almendras");
  assert.equal(fields.phone, "+56911112222");
  assert.equal(fields.comuna, "Quinta Normal");
  assert.deepEqual(filled.sort(), ["comuna", "phone_alt", "region", "rubro"]);
});
