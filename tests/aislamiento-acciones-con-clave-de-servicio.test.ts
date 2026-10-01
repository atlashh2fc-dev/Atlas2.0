import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Las acciones que escriben con la clave de servicio se saltan la RLS. Antes
 * de usarla tienen que comprobar con el cliente de sesión que lo que tocan es
 * de la empresa de quien actúa; si no, un id de otra empresa pasaba directo.
 */

const sip = readFileSync(new URL("../src/app/actions/agent-sip.ts", import.meta.url), "utf8");
const colas = readFileSync(new URL("../src/app/actions/contact-center-queues.ts", import.meta.url), "utf8");

/** Cuerpo de la función exportada `nombre`, hasta la siguiente exportación. */
function cuerpo(fuente: string, nombre: string): string {
  const inicio = fuente.indexOf(`export async function ${nombre}(`);
  assert.ok(inicio >= 0, `no se encontró ${nombre}`);
  const fin = fuente.indexOf("\nexport ", inicio + 1);
  return fuente.slice(inicio, fin < 0 ? undefined : fin);
}

function validaAntesDeLaClaveDeServicio(fuente: string, nombre: string, guardia: string) {
  const funcion = cuerpo(fuente, nombre);
  const posGuardia = funcion.indexOf(guardia);
  const posServicio = funcion.indexOf("createAdminClient()");
  assert.ok(posGuardia >= 0, `${nombre} no llama a ${guardia}`);
  assert.ok(posServicio >= 0, `${nombre} ya no usa la clave de servicio`);
  assert.ok(posGuardia < posServicio, `${nombre} valida la empresa después de usar la clave de servicio`);
}

test("las extensiones SIP solo se administran para personas visibles con la sesión", () => {
  assert.match(sip, /async function exigirPerfilDeMiEmpresa[\s\S]*?await createClient\(\)[\s\S]*?from\("profiles"\)/);
  assert.match(sip, /Solo puedes administrar extensiones de personas de tu empresa\./);
  validaAntesDeLaClaveDeServicio(sip, "provisionAgentExtension", "exigirPerfilDeMiEmpresa(");
  validaAntesDeLaClaveDeServicio(sip, "revealAgentSipCredential", "exigirPerfilDeMiEmpresa(");
});

test("las colas se editan solo si la sesión las ve", () => {
  assert.match(colas, /async function exigirColaVisible[\s\S]*?from\("contact_center_queues"\)/);
  for (const nombre of ["saveContactCenterQueue", "saveContactCenterQueueMembers", "conectarCorreoDeCampana", "desconectarFuenteDeCola"]) {
    validaAntesDeLaClaveDeServicio(colas, nombre, "exigirColaVisible(");
  }
});

test("la campaña y los ejecutivos de una cola se leen con la sesión", () => {
  const conectar = cuerpo(colas, "conectarCorreoDeCampana");
  assert.match(conectar, /supabase\.from\("campaigns"\)\.select\("id"\)\.eq\("id", campaignId\)/);
  const miembros = cuerpo(colas, "saveContactCenterQueueMembers");
  assert.match(miembros, /await supabase\.from\("profiles"\)\.select\("id"\)\.in\("id", selectedIds\)/);
  assert.doesNotMatch(miembros, /admin\.from\("profiles"\)/);
});
