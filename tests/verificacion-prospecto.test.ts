// Verificación en la web antes del primer WhatsApp.
//
// Si esto se rompe, Atlas le escribe a una fundación, a una veterinaria de
// caballos o al número de un desconocido (un fijo convertido a celular), o
// deja de escribirle a clínicas reales. Los casos son los del 15-10-2026,
// revisados a mano ese día.

import assert from "node:assert/strict";
import test from "node:test";

import {
  clasificarNegocio,
  consultasDeVerificacion,
  esRelevante,
  parsearBing,
  parsearDuckDuckGo,
  pistaDelCorreo,
  resultadosDesdeGooglePlaces,
  rubroDeLaCampana,
  telefonosChilenos,
  verificacionVigente,
  veredicto,
  type ResultadoWeb,
} from "../src/lib/verificacion-prospecto.ts";

const AHORA = new Date("2026-10-15T18:00:00.000Z");
const r = (titulo: string, url: string, fragmento: string): ResultadoWeb => ({ titulo, url, fragmento });

test("la pista del correo es la marca, no el nombre de una persona", () => {
  assert.equal(pistaDelCorreo("administracion@valdipets.com"), "valdipets");
  assert.equal(pistaDelCorreo("drcatalan@animalisvita.cl"), "animalisvita");
  assert.equal(pistaDelCorreo("koda.pet.vet@gmail.com"), "kodapet");
  assert.equal(pistaDelCorreo("blancoyvioletavet@gmail.com"), "blancoyvioletavet");
  assert.equal(pistaDelCorreo("dra.cerda@gmail.com"), null);
  assert.equal(pistaDelCorreo("soniaurrutia@ayudacallejeros.cl"), "ayudacallejeros");
  assert.equal(pistaDelCorreo(null), null);
});

test("se busca la razón social y, si hace falta, la marca del correo con el rubro", () => {
  assert.deepEqual(consultasDeVerificacion({ empresa: "Catrico Inversiones Limitada", email: "administracion@valdipets.com", rubro: "veterinaria" }), [
    "Catrico Inversiones Limitada Chile",
    "valdipets veterinaria",
  ]);
  assert.deepEqual(consultasDeVerificacion({ empresa: "Veterinaria Mariel Alejandra Riveros Velasquez Empresa Individual De Responsabil", email: "mariel.riveros@gmail.com", rubro: "veterinaria" })[0], "Veterinaria Mariel Alejandra Riveros Velasquez Empresa Individual De Responsabil Chile");
  assert.equal(rubroDeLaCampana("Altius · Atlas CRM Vet · Octubre 2026"), "veterinaria");
  assert.equal(rubroDeLaCampana("Altius · Atlas CRM Dental · Octubre 2026"), "dental");
  assert.equal(rubroDeLaCampana("Altius Web + IA · Septiembre 2026"), null);
});

test("se leen los resultados de DuckDuckGo lite y de Bing", () => {
  const ddg = `<tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.valdipets.cl%2F&amp;rut=abc" class='result-link'>ValdiPets | Cl&iacute;nica veterinaria</a></td></tr>
<tr><td class='result-snippet'>No realizamos despacho a domicilio. Reserva tu hora +56961254532.</td></tr>
<tr><td><a rel="nofollow" href="https://agendapro.com/site/cl/valdipets/33603" class='result-link'>ValdiPets · Isla Teja - Agenda ahora!</a></td></tr>
<tr><td class='result-snippet'>Contacto +56 961 254 532. Los Pelues 440, Valdivia.</td></tr>`;
  const resultados = parsearDuckDuckGo(ddg);
  assert.equal(resultados.length, 2);
  assert.equal(resultados[0].url, "https://www.valdipets.cl/");
  assert.match(resultados[0].titulo, /ValdiPets/);
  assert.match(resultados[1].fragmento, /Los Pelues 440/);

  const bing = `<li class="b_algo" data-id iid=SERP.5318><h2><a href="https://www.bing.com/ck/a?!&amp;p=1" h="ID=SERP">Veterinaria Vethealth: Inicio</a></h2><div class="b_caption"><cite>https://vethealth.cl</cite><p class="b_lineclamp2">Avenida Las Torres 143, Quilicura. 562 2607 1873 / 569 6898 0444</p></div></li>`;
  const [b] = parsearBing(bing);
  assert.equal(b.url, "https://vethealth.cl");
  assert.match(b.fragmento, /Quilicura/);
});

test("un resultado es relevante si trae la marca o la mayoría del nombre", () => {
  const valdipets = r("ValdiPets | Clínica veterinaria", "https://www.valdipets.cl/", "Reserva tu hora");
  assert.equal(esRelevante(valdipets, { empresa: "Catrico Inversiones Limitada", pista: "valdipets" }), true);
  assert.equal(esRelevante(valdipets, { empresa: "Catrico Inversiones Limitada", pista: null }), false);
  const arica = r("Veterinario en Arica", "https://infobel.com", "Carrera Y Fuentes. Avenida San Ignacio de Loyola 305 Arica.");
  assert.equal(esRelevante(arica, { empresa: "Carrera Y Fuentes Limitada", pista: null }), true);
  const otroFuentes = r("Fuentes de soda en Arica", "https://x.cl", "Las mejores fuentes de soda");
  assert.equal(esRelevante(otroFuentes, { empresa: "Carrera Y Fuentes Limitada", pista: null }), false);
});

test("los teléfonos chilenos se leen en cualquier formato, y un fijo no se confunde con un celular", () => {
  const { celulares, fijos } = telefonosChilenos("Teléfono: (63) 222 0151 · WhatsApp +56 9 6125 4532 · 9 8341 6524 · Blanco y Violeta CEL. 87333565 · 562 2607 1873");
  assert.deepEqual(celulares.sort(), ["56961254532", "56983416524", "56987333565"]);
  assert.deepEqual(fijos.sort(), ["56226071873", "56632220151"]);
});

test("otro giro se descarta con el motivo: fundación, caballos, lechería, tienda", () => {
  const casos: [string, string, ResultadoWeb[], string][] = [
    [
      "Fundación Ayuda Callejeros",
      "soniaurrutia@ayudacallejeros.cl",
      [r("Fundación Ayuda Callejeros", "https://www.fundacionayudacallejeros.cl", "Nos dedicamos al rescate, rehabilitación y adopción de animales abandonados. Apadrina un callejero.")],
      "ong",
    ],
    [
      "Veterinaria Medeq Spa",
      "felipe.acevedog@gmail.com",
      [r("Felipe Acevedo - Medicina Deportiva del Equino", "https://linkedin.com", "Director y Propietario Veterinaria Medeq Spa. Docente Manejo de Equinos"), r("MEDEQ VET", "https://instagram.com/medeq_vet_", "En Medeqvet cuidamos de tu caballo: odontología equina")],
      "equina",
    ],
    [
      "Dairyfarm Limitada",
      "pdiazcv@gmail.com",
      [r("Dairy Farm Chile", "https://linkedin.com", "Somos DairyFarm, una empresa de servicios agrícolas y ganaderos integrales. Administración de predios lecheros.")],
      "agro",
    ],
    [
      "Puntomascotas Spa",
      "dgutierrez@puntomascotas.cl",
      [r("Punto Mascotas", "https://puntomascotas.cl", "Tienda de animales en Ñuñoa. Alimentos para mascotas, accesorios. Pedido: ubereats")],
      "tienda",
    ],
  ];
  for (const [empresa, email, resultados, tipo] of casos) {
    const v = veredicto({ empresa, email, celular: "+56932945368", rubro: "veterinaria", resultados, ahora: AHORA });
    assert.equal(v.tipo, tipo, empresa);
    assert.equal(v.estado, "rechazado", empresa);
    assert.match(v.motivo, /no una veterinaria/, empresa);
  }
});

test("clínica real con el celular publicado: aprobado y confirmado", () => {
  const v = veredicto({
    empresa: "Servicios Veterinarios Vethealth Limitada",
    email: "adm.vethealth@gmail.com",
    celular: "+56968980444",
    rubro: "veterinaria",
    resultados: [r("Clínica Veterinaria Vethealth Quilicura", "https://vethealth.cl", "Clínica veterinaria. Llámanos: 562 2607 1873 / 569 6898 0444. Av. Las Torres 143, Quilicura")],
    ahora: AHORA,
  });
  assert.equal(v.estado, "aprobado");
  assert.equal(v.celular_confirmado, true);
  assert.equal(v.celular_corregido, null);
  assert.equal(v.tipo, "del_rubro");
});

test("clínica real con el celular del registro sin publicar: aprobado, y se dice", () => {
  const v = veredicto({
    empresa: "Veterinaria Animalis Vita Limitada",
    email: "drcatalan@animalisvita.cl",
    celular: "+56968463121",
    rubro: "veterinaria",
    resultados: [r("Clinica Veterinaria Animalis Vita", "https://www.animalisvita.cl", "Clínica veterinaria. Av. Las parcelas 830, La Serena. +56 953966096. Urgencias 24 hrs")],
    ahora: AHORA,
  });
  assert.equal(v.estado, "aprobado");
  assert.equal(v.celular_confirmado, false);
  assert.match(v.motivo, /del registro/);
});

test("un fijo mal convertido se reemplaza por el celular publicado; sin celular publicado, se descarta", () => {
  const valdipets = [r("ValdiPets | Clínica veterinaria y Peluquería canina", "https://www.valdipets.cl", "Clínica veterinaria. Teléfono (63) 222 0151. Reserva tu hora +56961254532. Los Pelues 440, Valdivia")];
  const v = veredicto({ empresa: "Catrico Inversiones Limitada", email: "administracion@valdipets.com", celular: "+56932220151", rubro: "veterinaria", resultados: valdipets, ahora: AHORA });
  assert.equal(v.estado, "aprobado");
  assert.equal(v.celular_corregido, "56961254532");
  assert.match(v.motivo, /fijo mal convertido/);

  const soloFijo = [r("ValdiPets | Clínica veterinaria", "https://www.valdipets.cl", "Clínica veterinaria. Teléfono (63) 222 0151. Los Pelues 440, Valdivia")];
  const sin = veredicto({ empresa: "Catrico Inversiones Limitada", email: "administracion@valdipets.com", celular: "+56932220151", rubro: "veterinaria", resultados: soloFijo, ahora: AHORA });
  assert.equal(sin.estado, "rechazado");
  assert.match(sin.motivo, /desconocido/);
});

test("lo que no aparece en la web queda pendiente para una persona, y se reintenta a la semana", () => {
  const v = veredicto({ empresa: "Servicios Médicos Veterinarios Alfaro Limitada", email: "alirolfr@gmail.com", celular: "+56945915470", rubro: "veterinaria", resultados: [r("Veterinarias en Santiago", "https://guiaveterinarias.cl", "Directorio de clínicas")], ahora: AHORA });
  assert.equal(v.estado, "pendiente");
  assert.equal(v.tipo, "desconocido");
  assert.equal(verificacionVigente(v, AHORA), true);
  assert.equal(verificacionVigente(v, new Date(AHORA.getTime() + 8 * 24 * 60 * 60 * 1000)), false);
  assert.equal(verificacionVigente({ ...v, estado: "rechazado" }, new Date(AHORA.getTime() + 90 * 24 * 60 * 60 * 1000)), true);
  assert.equal(verificacionVigente(undefined, AHORA), false);
});

test("la palabra «veterinaria» en la razón social no convierte a una consultora en clínica", () => {
  assert.equal(clasificarNegocio([r("Sociedad Veterinaria Horse House Ltda", "https://datalux.cl", "empresa dedicada a comercio al por mayor de productos para caballos")], "veterinaria"), "equina");
  assert.equal(clasificarNegocio([], "veterinaria"), "desconocido");
  assert.equal(clasificarNegocio([r("Clínica Veterinaria Las Palmas - Agenda ahora!", "https://agendapro.com", "Las Palmas es una Clínica Veterinaria con mas de 10 años cuidando perros y gatos")], "veterinaria"), "del_rubro");
});

test("un lugar de Google Places se lee como resultado: tipo traducido, teléfono y reseñas", () => {
  const [valdipets, cerrado] = [
    resultadosDesdeGooglePlaces([
      {
        displayName: { text: "ValdiPets" },
        formattedAddress: "Los Pelues 440, Valdivia, Los Ríos",
        types: ["veterinary_care", "pet_store", "point_of_interest"],
        nationalPhoneNumber: "(63) 222 0151",
        internationalPhoneNumber: "+56 63 222 0151",
        websiteUri: "https://www.valdipets.cl/",
        rating: 4.8,
        userRatingCount: 232,
        businessStatus: "OPERATIONAL",
      },
    ]),
    resultadosDesdeGooglePlaces([{ displayName: { text: "Vet Cerrada" }, businessStatus: "CLOSED_PERMANENTLY" }]),
  ];
  assert.equal(valdipets.length, 1);
  assert.equal(valdipets[0].titulo, "ValdiPets");
  assert.equal(valdipets[0].url, "https://www.valdipets.cl/");
  assert.match(valdipets[0].fragmento, /clínica veterinaria, tienda de mascotas/);
  assert.match(valdipets[0].fragmento, /232 reseñas/);
  assert.equal(cerrado.length, 0);
  // Con ese lugar, el veredicto detecta el fijo mal convertido aunque Google no publique el celular: se descarta.
  const v = veredicto({ empresa: "Catrico Inversiones Limitada", email: "administracion@valdipets.com", celular: "+56932220151", rubro: "veterinaria", resultados: valdipets, ahora: AHORA });
  assert.equal(v.estado, "rechazado");
  assert.match(v.motivo, /fijo mal convertido/);
});
