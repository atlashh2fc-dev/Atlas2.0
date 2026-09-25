import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  ENCABEZADOS_DATA,
  diaEnChile,
  libroNegociosEquifax,
  nombreArchivoNegocios,
  plataformaDeAsesor,
  rutPlanilla,
  tipoContrato,
  type NegocioEquifax,
} from "../src/lib/equifax-negocios-excel.ts";

// Filas con la forma que devuelve la RPC get_equifax_negocios.
const NEGOCIOS: NegocioEquifax[] = [
  {
    lead_id: "9038670f-ad3c-4b3a-8d5e-3e17496ac969",
    campana: "Equifax",
    origen: "Base Atlas 1",
    asesor: "Karina Halaby",
    rut: "77.912.576-9",
    empresa: "MOVITUTTO EXPRESS SPA",
    productos: ["Bundle MC Ilimitado"],
    uf: "2.5",
    q_consultas: "10",
    id_audio: "4565a9ca-1d78-4846-bc9b-f7e3761a4cf8",
    estado: "APROBADO DEFINITIVO",
    observacion: "hector 933954481  esperpo docuemnbtos",
    nombre_cliente: "Hector de la Puente",
    telefono: "+56933954481",
    email: "cobranza@movitutto.cl",
    observaciones_equipo: "14-08-2026: hector 933954481 envie 2 cccot bundle / 03-09-2026: Hector 933954481 e",
    fecha_seguimiento: null,
    fecha_gestion: "2026-08-14",
    fecha_ok_contrato: "2026-09-03",
    ultima_gestion: "VENTA EN VALIDACION",
    fecha_ultima_gestion: "2026-09-03",
  },
  {
    lead_id: "1009d795-335e-4aa8-92d2-c4719996b547",
    campana: "Equifax",
    origen: "Base Atlas 1",
    asesor: "EDUARDO RODRIGO PEREZ MOYA",
    rut: "76.349.842-5",
    empresa: "ACCUVISION SPA.",
    productos: ["Bolsa RI"],
    uf: 3,
    id_audio: "6d20f59a-433b-4dae-8cfd-776b7dba8030",
    estado: "PDTE RESPUESTA CLIENTE",
    observacion: null,
    nombre_cliente: null,
    telefono: "+56933891294",
    email: null,
    observaciones_equipo: null,
    // 23:30 del 30-09 en Chile ya es 1-10 en UTC: la agenda se muestra en hora Chile.
    fecha_seguimiento: "2026-10-01T02:30:00+00:00",
    fecha_gestion: "2026-07-02",
    fecha_ok_contrato: null,
    ultima_gestion: "VOLVER A LLAMAR",
    fecha_ultima_gestion: "2026-07-10",
  },
];

function leer(libro: Uint8Array) {
  return XLSX.read(libro, { type: "buffer" });
}

test("la hoja Data lleva los encabezados de la planilla de operación, en su orden", () => {
  const libro = leer(libroNegociosEquifax(NEGOCIOS));
  assert.deepEqual(libro.SheetNames, ["Data", "TD"]);
  const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets.Data, { header: 1, raw: true, defval: null });
  assert.deepEqual(filas[0], [...ENCABEZADOS_DATA]);
  // Las 24 primeras columnas son las de la planilla, con sus erratas y espacios.
  assert.equal(ENCABEZADOS_DATA[21], "FECHA GETION ");
  assert.equal(ENCABEZADOS_DATA[3], "PLATAFORMA ");
  assert.equal(filas.length, 3);
});

test("cada negocio se escribe como lo pega operación", () => {
  const libro = leer(libroNegociosEquifax(NEGOCIOS));
  const [venta, pendiente] = XLSX.utils.sheet_to_json<Record<string, unknown>>(libro.Sheets.Data, { raw: false, defval: null });
  assert.equal(venta["AÑO"], "2026");
  assert.equal(venta["MES CIERRE"], "AGOSTO");
  assert.equal(venta["PLATAFORMA "], "PLACA");
  assert.equal(venta.RUT, "779125769");
  assert.equal(venta["TIPO CONTRATO"], "RECURRENTE");
  assert.equal(venta.PRODUCTO, "Bundle MC Ilimitado");
  assert.equal(venta.UF, "2.5");
  assert.equal(venta.ESTADO, "APROBADO DEFINITIVO");
  assert.equal(venta["FECHA GETION "], "14-08-2026");
  assert.equal(venta["fecha  ok contrato "], "03-09-2026");
  assert.equal(venta.Q, "10");
  assert.equal(venta.$, null);
  assert.equal(venta["NUMERO CONTRATO "], null);
  assert.equal(venta["ULTIMA GESTION"], "03-09-2026 · VENTA EN VALIDACION");

  assert.equal(pendiente["PLATAFORMA "], "NORMAL");
  assert.equal(pendiente["TIPO CONTRATO"], "ONE TIME");
  assert.equal(pendiente["fecha seguimiento"], "30-09-2026");
  assert.equal(pendiente.Q, null);
});

test("las fechas son fechas de Excel y la UF es número, para filtrar y sumar", () => {
  const hoja = XLSX.read(libroNegociosEquifax(NEGOCIOS), { type: "buffer", cellNF: true }).Sheets.Data;
  assert.equal(hoja.V2.t, "n");
  assert.equal(hoja.V2.z, "dd-mm-yyyy");
  assert.equal(hoja.L2.t, "n");
  assert.equal(hoja.L2.v, 2.5);
  assert.equal(hoja.J2.t, "n");
  assert.equal(hoja.J2.v, 10);
  assert.equal(hoja["!autofilter"]?.ref, "A1:Y3");
});

test("la hoja TD suma la UF por tipo de contrato y estado", () => {
  const td = XLSX.utils.sheet_to_json<unknown[]>(leer(libroNegociosEquifax(NEGOCIOS)).Sheets.TD, { header: 1, raw: true, defval: null });
  assert.deepEqual(td[0].slice(0, 2), ["Suma de UF", "Estado"]);
  assert.deepEqual(td[1], ["Tipo contrato", "APROBADO DEFINITIVO", "PDTE RESPUESTA CLIENTE", "Total general"]);
  assert.deepEqual(td[2], ["ONE TIME", null, 3, 3]);
  assert.deepEqual(td[3], ["RECURRENTE", 2.5, null, 2.5]);
  assert.deepEqual(td[4], ["Total general", 2.5, 3, 5.5]);
});

test("un libro sin negocios igual se descarga con sus encabezados", () => {
  const libro = leer(libroNegociosEquifax([]));
  const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets.Data, { header: 1 });
  assert.deepEqual(filas[0], [...ENCABEZADOS_DATA]);
});

test("plataforma, tipo de contrato y RUT siguen las hojas Dotacion y Hoja5", () => {
  assert.equal(plataformaDeAsesor("Ximena Cofre"), "NORMAL");
  assert.equal(plataformaDeAsesor("Andrea Soledad Zuñiga Bustos"), "NORMAL");
  assert.equal(plataformaDeAsesor("Marcela Liliana Mora Morales"), "PLACA");
  assert.equal(plataformaDeAsesor(null), "");
  assert.equal(tipoContrato(["Documento Unico"]), "PUBLICACION UNICA");
  assert.equal(tipoContrato(["BBDD"]), "ONE TIME");
  assert.equal(tipoContrato(["Bolsa RI", "Reporte Interactivo"]), "RECURRENTE");
  assert.equal(tipoContrato(["MC 4100"]), "RECURRENTE");
  assert.equal(tipoContrato([]), "");
  assert.equal(rutPlanilla("76.600.685-k"), "76600685K");
  assert.equal(diaEnChile("2026-09-26T02:00:00Z"), "2026-09-25");
  assert.equal(nombreArchivoNegocios("2026-09-25"), "NEGOCIOS EN CURSO INFOBUSINESS SEPTIEMBRE 2026.xlsx");
});

test("Reportes ofrece la descarga al admin y al supervisor", () => {
  // Lo que se agrega a una rama de Reportes no llega sola a la otra.
  const page = readFileSync(new URL("../src/app/dashboard/reportes/page.tsx", import.meta.url), "utf8");
  const supervisorBranch = page.slice(page.indexOf('if (profile.role === "supervisor")'), page.indexOf("const { data: campaignList }"));
  const adminBranch = page.slice(page.indexOf("const { data: campaignList }"));
  assert.match(supervisorBranch, /<EquifaxNegociosDownload/);
  assert.match(adminBranch, /<EquifaxNegociosDownload/);
  assert.match(page, /\/api\/reportes\/equifax-negocios/);
});
