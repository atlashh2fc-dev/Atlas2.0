/**
 * Antes de escribirle por WhatsApp a un prospecto, Atlas lo busca en la web y
 * decide si de verdad es el negocio que creemos y si el celular es suyo.
 *
 * Por qué existe (15-10-2026): los primeros 15 de la fila venían de Bigdata
 * (SII). El nombre era la razón social, el rubro era «clínicas veterinarias»
 * y el celular, el del representante legal. Revisados uno por uno en Google:
 * una fundación de rescate, una asesoría lechera, una veterinaria de
 * caballos, una tienda de mascotas, una sociedad sin presencia pública, y un
 * fijo convertido a celular (63 222 0151 → «9 3222 0151», el número de un
 * desconocido). Hugo: «ventas, no enviar por enviar». Esta revisión es la
 * misma que se hizo a mano ese día, pero antes de cada envío y sin pasos
 * manuales.
 *
 * Dónde se busca (verificacion-prospecto.server.ts): en Google Places si hay
 * clave (GOOGLE_PLACES_API_KEY: dice el tipo de negocio, el teléfono y las
 * reseñas), y si no, en DuckDuckGo o Bing como un navegador, que encuentran
 * menos y se cansan rápido. Lo que no se encuentra queda pendiente y, desde
 * el 16-10, igual recibe el saludo (ver puedeRecibirSaludo); lo descartado no.
 *
 * Puro: recibe resultados de búsqueda ya descargados y devuelve un veredicto
 * con su motivo.
 */

import { nombreComoSeDice } from "./prospeccion.ts";

export type ResultadoWeb = { titulo: string; url: string; fragmento: string };

export type RubroEsperado = "veterinaria" | "dental" | "barberia" | null;

export type TipoDeNegocio = "del_rubro" | "equina" | "ong" | "tienda" | "agro" | "otro" | "desconocido";

export type Verificacion = {
  estado: "aprobado" | "rechazado" | "pendiente";
  /** Para una persona: por qué se aprobó, se descartó o quedó en duda. */
  motivo: string;
  tipo: TipoDeNegocio;
  /** Cómo se llama en la web, si se encontró (el nombre de fantasía, no la razón social). */
  nombre_web: string | null;
  /** Celulares publicados por el negocio, en dígitos (569…). */
  celulares_publicados: string[];
  /** ¿Nuestro celular aparece publicado por el negocio? */
  celular_confirmado: boolean;
  /** Si nuestro número era un fijo mal convertido, el celular publicado que lo reemplaza (569…). */
  celular_corregido: string | null;
  evidencia: string[];
  fecha: string;
  fuente: string;
};

/** Cuántas verificaciones nuevas por corrida: cada una son una o dos búsquedas, y el cron tiene 60 segundos. */
export const VERIFICACIONES_POR_CORRIDA = 4;

/** Un «pendiente» se vuelve a intentar pasados estos días (quizá ya tiene presencia, o la búsqueda falló). */
export const DIAS_PARA_REINTENTAR_PENDIENTE = 7;

/**
 * ¿Le puede llegar el saludo? Sí si se aprobó, y también si la búsqueda
 * automática no lo encontró (Hugo, 16-10: «si no, envía no más»: sin clave de
 * Google casi nada aparece y salía un WhatsApp al día). No si se descartó
 * (otro giro, fijo mal convertido, sin forma de celular) ni si una persona lo
 * revisó y lo dejó en duda.
 */
export function puedeRecibirSaludo(verificacion: Pick<Verificacion, "estado" | "fuente">): boolean {
  if (verificacion.estado === "aprobado") return true;
  return verificacion.estado === "pendiente" && !/manual/i.test(verificacion.fuente ?? "");
}

const sinTildes = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
const plano = (texto: string) => sinTildes(texto.toLowerCase());
const compacto = (texto: string) => plano(texto).replace(/[^a-z0-9]/g, "");

const decodificarEntidades = (texto: string) =>
  texto
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

const sinEtiquetas = (html: string) => decodificarEntidades(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** El rubro que la campaña promete, para saber qué palabras confirman el negocio. */
export function rubroDeLaCampana(campana: string | null | undefined): RubroEsperado {
  const texto = plano(campana ?? "");
  if (/veterin|\bvet\b|mascota/.test(texto)) return "veterinaria";
  if (/dental|odont/.test(texto)) return "dental";
  if (/barber|peluquer/.test(texto)) return "barberia";
  return null;
}

const PALABRA_DEL_RUBRO: Record<Exclude<RubroEsperado, null>, string> = {
  veterinaria: "veterinaria",
  dental: "dental",
  barberia: "barbería",
};

/**
 * Qué buscar: primero la razón social tal cual (con «Chile»), y si eso no la
 * encuentra, la pista del correo (valdipets, animalisvita…) con el rubro. La
 * segunda consulta solo se usa si la primera no trae nada relevante.
 */
export function consultasDeVerificacion({ empresa, email, rubro }: { empresa: string | null; email?: string | null; rubro: RubroEsperado }): string[] {
  const consultas: string[] = [];
  const nombre = (empresa ?? "").trim();
  if (nombre) consultas.push(`${nombre} Chile`);
  const pista = pistaDelCorreo(email);
  const palabra = rubro ? PALABRA_DEL_RUBRO[rubro] : "";
  if (pista && !compacto(nombre).includes(pista)) consultas.push(`${pista} ${palabra}`.trim());
  else if (nombre) {
    const corto = nombreComoSeDice(nombre);
    if (corto && corto !== nombre) consultas.push(`${corto} ${palabra}`.trim());
  }
  return consultas;
}

const CORREOS_GENERICOS = new Set(["gmail", "hotmail", "outlook", "yahoo", "live", "icloud", "me", "msn", "protonmail"]);
const PALABRAS_DE_CORREO = /^(info|contacto|contact|ventas|admin|administracion|adm|hola|gerencia|secretaria|recepcion|reservas|clinica|consulta|dr|dra|doctor|doctora|vet|veterinaria|veterinario)$/;

/**
 * La marca escondida en el correo: el dominio propio (valdipets.com → valdipets)
 * o, en un correo genérico, la parte antes de la arroba sin palabras de relleno
 * (koda.pet.vet@gmail.com → kodapet). Null si no dice nada (dra.cerda@gmail.com).
 */
export function pistaDelCorreo(email: string | null | undefined): string | null {
  const [usuario, dominio] = (email ?? "").toLowerCase().trim().split("@");
  if (!usuario || !dominio) return null;
  const [raiz] = dominio.split(".");
  if (raiz && !CORREOS_GENERICOS.has(raiz)) return raiz.length >= 4 ? raiz : null;
  const partes = usuario
    .split(/[._-]+/)
    .filter((parte) => parte && !PALABRAS_DE_CORREO.test(parte) && !/^\d+$/.test(parte) && !/^[a-z]{1,2}$/.test(parte));
  // Un nombre de persona (sonia + urrutia) no es una marca; una marca suele ser una o dos palabras que no parecen nombre.
  const pista = partes.join("");
  // Cinco letras pueden ser un apellido (dra.cerda); una marca suele ser más larga.
  return pista.length >= 6 && partes.length <= 2 ? pista : null;
}

/** Los resultados de DuckDuckGo (versión lite): título, enlace real y fragmento. */
export function parsearDuckDuckGo(html: string): ResultadoWeb[] {
  const enlaces = [...html.matchAll(/<a[^>]*href="([^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/g)];
  const fragmentos = [...html.matchAll(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/g)].map((m) => sinEtiquetas(m[1]));
  return enlaces.map((m, i) => ({ titulo: sinEtiquetas(m[2]), url: urlReal(decodificarEntidades(m[1])), fragmento: fragmentos[i] ?? "" })).filter((r) => r.url);
}

/** Los resultados de Bing: cada <li class="b_algo"> con su título, enlace y párrafo. */
export function parsearBing(html: string): ResultadoWeb[] {
  return [...html.matchAll(/<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g)]
    .map((m) => {
      const bloque = m[1];
      const enlace = bloque.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const parrafo = bloque.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      const cita = bloque.match(/<cite[^>]*>([\s\S]*?)<\/cite>/);
      if (!enlace) return null;
      const url = cita ? sinEtiquetas(cita[1]) : decodificarEntidades(enlace[1]);
      return { titulo: sinEtiquetas(enlace[2]), url, fragmento: parrafo ? sinEtiquetas(parrafo[1]) : "" };
    })
    .filter((r): r is ResultadoWeb => r !== null);
}

/** Lo que Google Places (API nueva, searchText) dice de un lugar. */
export type LugarDeGoogle = {
  displayName?: { text?: string };
  formattedAddress?: string;
  types?: string[];
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
};

const TIPOS_DE_GOOGLE: Record<string, string> = {
  veterinary_care: "clínica veterinaria",
  pet_store: "tienda de mascotas",
  animal_shelter: "refugio de rescate y adopción",
  farm: "predio agrícola",
  dentist: "clínica dental",
  dental_clinic: "clínica dental",
  hair_salon: "peluquería",
  barber_shop: "barbería",
  hair_care: "peluquería",
};

/**
 * Cada lugar de Google como un resultado de búsqueda: el nombre, su web o su
 * ficha en Maps, y un fragmento con el tipo (traducido a lo que entienden las
 * reglas), la dirección, los teléfonos y las reseñas.
 */
export function resultadosDesdeGooglePlaces(lugares: LugarDeGoogle[] | null | undefined): ResultadoWeb[] {
  return (lugares ?? [])
    .filter((lugar) => lugar.displayName?.text && lugar.businessStatus !== "CLOSED_PERMANENTLY")
    .map((lugar) => {
      const tipos = (lugar.types ?? []).map((tipo) => TIPOS_DE_GOOGLE[tipo]).filter(Boolean);
      const telefonos = [lugar.internationalPhoneNumber, lugar.nationalPhoneNumber].filter(Boolean).join(" · ");
      const resenas = lugar.userRatingCount ? `${lugar.rating ?? "?"} (${lugar.userRatingCount} reseñas en Google)` : "sin reseñas en Google";
      return {
        titulo: lugar.displayName?.text ?? "",
        url: lugar.websiteUri ?? lugar.googleMapsUri ?? "",
        fragmento: [tipos.join(", ") || "lugar", lugar.formattedAddress ?? "", telefonos, resenas].filter(Boolean).join(" · "),
      };
    });
}

/** DuckDuckGo envuelve el destino en //duckduckgo.com/l/?uddg=…; se devuelve el destino. */
function urlReal(url: string): string {
  const m = url.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return url;
    }
  }
  return url.startsWith("//") ? `https:${url}` : url;
}

const PALABRAS_SIN_PESO = new Set([
  "limitada", "ltda", "spa", "sa", "eirl", "sociedad", "comercial", "servicios", "servicio", "clinica", "veterinaria", "veterinarios", "veterinario", "medicos", "medico", "centro", "consultoria", "integral", "inversiones", "empresa", "individual", "responsabilidad", "de", "del", "la", "las", "los", "el", "y", "e", "en", "chile",
]);

/** Las palabras que identifican al negocio dentro de la razón social (sin «limitada», «veterinaria», etc.). */
export function palabrasClave(empresa: string | null): string[] {
  return plano(empresa ?? "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length >= 3 && !PALABRAS_SIN_PESO.has(p));
}

/**
 * ¿Este resultado habla de nuestro negocio? Sí cuando aparece la pista del
 * correo (la marca) o la mayoría de las palabras clave del nombre.
 */
export function esRelevante(resultado: ResultadoWeb, { empresa, pista }: { empresa: string | null; pista: string | null }): boolean {
  const texto = compacto(`${resultado.titulo} ${resultado.url} ${resultado.fragmento}`);
  if (pista && pista.length >= 5 && texto.includes(pista)) return true;
  const claves = palabrasClave(empresa);
  if (claves.length === 0) return false;
  const textoPlano = plano(`${resultado.titulo} ${resultado.fragmento}`);
  const presentes = claves.filter((clave) => textoPlano.includes(clave)).length;
  // Un apellido suelto no basta: para «Carrera y Fuentes» hacen falta las dos palabras.
  return presentes >= Math.max(1, Math.ceil(claves.length / 2)) && (claves.length === 1 || presentes >= 2);
}

const SENALES: Record<Exclude<TipoDeNegocio, "del_rubro" | "otro" | "desconocido">, RegExp> = {
  equina: /equin[oa]s?|caballos?|\bhorse\b|hipic[oa]|yeguas?|potros?/g,
  ong: /fundaci[oó]n|\bong\b|rescate|adopci[oó]n|sin fines de lucro|apadrina|refugio/g,
  agro: /agr[ií]cola|lecher[oa]|ganader|dairy|predios?|comercio al por mayor|forestal|salmon/g,
  tienda: /tienda de (animales|mascotas)|pet ?shops?|alimentos? para mascotas|accesorios para mascotas|tienda online/g,
};

const RUBRO: Record<Exclude<RubroEsperado, null>, RegExp> = {
  veterinaria: /cl[ií]nica veterinaria|veterinari[oa]s?\b|hospital veterinario|consulta veterinaria|mascotas?|perros? y gatos|urgencias? veterinaria/g,
  dental: /cl[ií]nica dental|dentistas?|odont[oó]log|ortodoncia|implantes?/g,
  barberia: /barber[ií]a|barber ?shop|peluquer[ií]a|cortes? de pelo|barberos?/g,
};

const contar = (texto: string, patron: RegExp) => (texto.match(patron) ?? []).length;

/**
 * Qué negocio es, según lo que dice la web de él. Las señales de otro giro
 * (caballos, fundación, lechería, tienda) pesan más que la palabra
 * «veterinaria», que aparece hasta en la razón social de una consultora.
 */
export function clasificarNegocio(relevantes: ResultadoWeb[], rubro: RubroEsperado): TipoDeNegocio {
  if (relevantes.length === 0) return "desconocido";
  const texto = plano(relevantes.map((r) => `${r.titulo} ${r.fragmento}`).join(" · "));
  const delRubro = rubro ? contar(texto, RUBRO[rubro]) : 0;
  const equina = contar(texto, SENALES.equina);
  const ong = contar(texto, SENALES.ong);
  const agro = contar(texto, SENALES.agro);
  const tienda = contar(texto, SENALES.tienda);
  if (ong >= 1 && ong * 2 >= delRubro) return "ong";
  if (equina >= 2 || (equina >= 1 && delRubro === 0)) return "equina";
  if (agro >= 1 && delRubro === 0) return "agro";
  if (tienda >= 1 && tienda >= delRubro) return "tienda";
  if (delRubro >= 1) return "del_rubro";
  return rubro ? "otro" : "desconocido";
}

/**
 * Los teléfonos chilenos escritos en un texto, en dígitos con el 56 por delante:
 * celulares (569 + 8) y fijos (56 + código de área + número). Un número de 8
 * dígitos al lado de «cel», «celular» o «WhatsApp» cuenta como celular (así se
 * escribían antes del 2016).
 */
export function telefonosChilenos(texto: string): { celulares: string[]; fijos: string[] } {
  const celulares = new Set<string>();
  const fijos = new Set<string>();
  const limpio = texto.replace(/[ ]/g, " ");
  for (const m of limpio.matchAll(/(?:\+?56[\s-]?)?(?:\(?0?9\)?)[\s-]?(\d{4})[\s-]?(\d{4})\b/g)) celulares.add(`569${m[1]}${m[2]}`);
  for (const m of limpio.matchAll(/(?:\+?56[\s-]?)?\(?(2|3[2-9]|4[1-5]|5[1-8]|6[1-7]|7[1-5])\)?[\s-]?(\d{3,4})[\s-]?(\d{4})\b/g)) {
    const numero = `${m[2]}${m[3]}`;
    if ((m[1] === "2" && numero.length === 8) || (m[1] !== "2" && numero.length === 7)) fijos.add(`56${m[1]}${numero}`);
  }
  for (const m of limpio.matchAll(/(?:cel(?:ular)?|whatsapp|wsp|m[oó]vil)\W{0,12}(?:\+?56\s?)?(?:9\s?)?(\d{4})\s?(\d{4})\b/gi)) celulares.add(`569${m[1]}${m[2]}`);
  return { celulares: [...celulares], fijos: [...fijos] };
}

const ultimos8 = (digitos: string) => digitos.slice(-8);

const NOMBRE_DEL_TIPO: Record<TipoDeNegocio, string> = {
  del_rubro: "del rubro",
  equina: "veterinaria equina (caballos)",
  ong: "fundación u ONG de rescate",
  tienda: "tienda de mascotas",
  agro: "servicios agrícolas o ganaderos",
  otro: "otro giro",
  desconocido: "sin información",
};

/**
 * El veredicto. Aprobado solo si la web confirma que es un negocio del rubro y
 * el celular es suyo o, al menos, tiene forma de celular y no es un fijo mal
 * convertido. Lo que no se encuentra queda pendiente (una persona decide);
 * lo que es otro giro se descarta con el motivo.
 */
export function veredicto({
  empresa,
  email,
  celular,
  rubro,
  resultados,
  ahora = new Date(),
  fuente = "web",
}: {
  empresa: string | null;
  email?: string | null;
  /** Nuestro número, como venga (se normaliza). */
  celular: string | null;
  rubro: RubroEsperado;
  resultados: ResultadoWeb[];
  ahora?: Date;
  fuente?: string;
}): Verificacion {
  const pista = pistaDelCorreo(email);
  const relevantes = resultados.filter((r) => esRelevante(r, { empresa, pista }));
  const base = { nombre_web: relevantes[0]?.titulo.split(/\s[|·—-]\s/)[0]?.trim() ?? null, evidencia: relevantes.slice(0, 4).map((r) => r.url), fecha: ahora.toISOString(), fuente };
  const nuestro = (celular ?? "").replace(/\D/g, "");
  const nuestros8 = nuestro.length >= 8 ? ultimos8(nuestro) : null;

  if (relevantes.length === 0) {
    return { ...base, estado: "pendiente", motivo: "No se encontró el negocio en la web; que lo mire una persona.", tipo: "desconocido", celulares_publicados: [], celular_confirmado: false, celular_corregido: null };
  }

  const tipo = clasificarNegocio(relevantes, rubro);
  const { celulares, fijos } = telefonosChilenos(relevantes.map((r) => `${r.titulo} ${r.fragmento}`).join(" · "));
  const confirmado = nuestros8 !== null && celulares.some((c) => ultimos8(c) === nuestros8);
  const esFijoConvertido = !confirmado && nuestros8 !== null && fijos.some((f) => ultimos8(f) === nuestros8);
  const comun = { tipo, celulares_publicados: celulares, celular_confirmado: confirmado };

  if (tipo !== "del_rubro") {
    const estado = tipo === "desconocido" || tipo === "otro" ? "pendiente" : "rechazado";
    const motivo = estado === "rechazado" ? `En la web es ${NOMBRE_DEL_TIPO[tipo]}, no ${rubro ? `una ${PALABRA_DEL_RUBRO[rubro]}` : "el negocio esperado"}.` : "Se encontró algo, pero no dice qué negocio es; que lo mire una persona.";
    return { ...base, ...comun, estado, motivo, celular_corregido: null };
  }

  if (esFijoConvertido) {
    const reemplazo = celulares[0] ?? null;
    if (reemplazo) {
      return { ...base, ...comun, estado: "aprobado", motivo: `Negocio real (${base.nombre_web ?? "en la web"}). El número venía de un fijo mal convertido; se usa el celular publicado.`, celular_corregido: reemplazo };
    }
    return { ...base, ...comun, estado: "rechazado", motivo: "El número es un fijo mal convertido a celular y el negocio no publica celular: escribirle sería a un desconocido.", celular_corregido: null };
  }

  if (!nuestros8 || !/^569\d{8}$/.test(nuestro.length === 9 ? `56${nuestro}` : nuestro)) {
    return { ...base, ...comun, estado: "rechazado", motivo: "El teléfono no tiene forma de celular chileno.", celular_corregido: null };
  }

  return {
    ...base,
    ...comun,
    estado: "aprobado",
    motivo: confirmado
      ? `Negocio real (${base.nombre_web ?? "en la web"}) y el celular está publicado por ellos.`
      : `Negocio real (${base.nombre_web ?? "en la web"}); el celular es el del registro (no está publicado, pero tiene forma de celular).`,
    celular_corregido: null,
  };
}

/** ¿La verificación guardada sigue valiendo, o hay que volver a mirar? */
export function verificacionVigente(guardada: Partial<Verificacion> | null | undefined, ahora: Date): guardada is Verificacion {
  if (!guardada || !guardada.estado || !guardada.fecha) return false;
  if (guardada.estado !== "pendiente") return true;
  return new Date(guardada.fecha).getTime() > ahora.getTime() - DIAS_PARA_REINTENTAR_PENDIENTE * 24 * 60 * 60 * 1000;
}
