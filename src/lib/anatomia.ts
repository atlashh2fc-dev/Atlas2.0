/**
 * Anatomía de la mascota para el mapa clínico: zonas del cuerpo, tipos de
 * registro y las razas con sus proporciones y su pelaje.
 *
 * Puro y sin three.js: lo usan el modelo 3D, el panel, la acción que guarda y
 * las pruebas. Las medidas son relativas al largo del cuerpo (1 = un cuerpo).
 */

export const REGIONES = [
  "cabeza", "ojos", "oidos", "boca", "cuello", "torax", "abdomen", "lomo", "cadera",
  "pata_delantera_izquierda", "pata_delantera_derecha", "pata_trasera_izquierda", "pata_trasera_derecha",
  "cola", "piel",
] as const;
export type Region = (typeof REGIONES)[number];

export const NOMBRE_REGION: Record<Region, string> = {
  cabeza: "Cabeza",
  ojos: "Ojos",
  oidos: "Oídos",
  boca: "Boca y dientes",
  cuello: "Cuello",
  torax: "Tórax",
  abdomen: "Abdomen",
  lomo: "Lomo",
  cadera: "Cadera y pelvis",
  pata_delantera_izquierda: "Pata delantera izquierda",
  pata_delantera_derecha: "Pata delantera derecha",
  pata_trasera_izquierda: "Pata trasera izquierda",
  pata_trasera_derecha: "Pata trasera derecha",
  cola: "Cola",
  piel: "Piel (general)",
};

export const TIPOS = ["hallazgo", "enfermedad", "lesion", "tratamiento", "cirugia", "control"] as const;
export type TipoRegistro = (typeof TIPOS)[number];

export const INFO_TIPO: Record<TipoRegistro, { label: string; color: string }> = {
  hallazgo: { label: "Hallazgo", color: "#f59e0b" },
  enfermedad: { label: "Enfermedad", color: "#dc2626" },
  lesion: { label: "Lesión", color: "#ea580c" },
  tratamiento: { label: "Tratamiento", color: "#2563eb" },
  cirugia: { label: "Cirugía", color: "#9333ea" },
  control: { label: "Control", color: "#0d9488" },
};

/** Sugerencias frecuentes por zona, para escribir rápido en consulta. */
export const SUGERENCIAS: Partial<Record<Region, string[]>> = {
  oidos: ["Otitis externa", "Otitis media", "Ácaros (otodectes)", "Hematoma auricular"],
  ojos: ["Conjuntivitis", "Úlcera corneal", "Cataratas", "Queratoconjuntivitis seca"],
  boca: ["Enfermedad periodontal", "Sarro", "Fractura dental", "Gingivitis", "Destartraje bajo anestesia"],
  piel: ["Dermatitis alérgica", "Pioderma", "Sarna", "Pulgas", "Masa cutánea"],
  abdomen: ["Gastroenteritis", "Ovariohisterectomía", "Cuerpo extraño", "Ecografía abdominal"],
  torax: ["Soplo cardíaco", "Masa subcutánea", "Tos de las perreras", "Radiografía de tórax"],
  cadera: ["Displasia de cadera", "Orquiectomía (castración)", "Artrosis"],
  cola: ["Herida en la cola", "Glándulas perianales"],
  pata_trasera_derecha: ["Rotura de ligamento cruzado", "Luxación de rótula", "TPLO", "Herida en almohadilla"],
  pata_trasera_izquierda: ["Rotura de ligamento cruzado", "Luxación de rótula", "TPLO", "Herida en almohadilla"],
  pata_delantera_derecha: ["Cojera", "Fractura de radio", "Herida en almohadilla", "Uña encarnada"],
  pata_delantera_izquierda: ["Cojera", "Fractura de radio", "Herida en almohadilla", "Uña encarnada"],
};

export type Especie = "Perro" | "Gato";
export type Orejas = "erecta" | "caida" | "semi" | "murcielago" | "felina";
export type Cola = "recta" | "enroscada" | "corta" | "esponjosa" | "larga";

export type Raza = {
  nombre: string;
  especie: Especie;
  /** Peso típico, solo para mostrar. */
  peso: string;
  /** Tamaño en pantalla: 1 es un perro mediano. */
  tamano: number;
  largo: number;
  radio: number;
  patas: { largo: number; grosor: number };
  cabeza: number;
  hocico: { largo: number; ancho: number };
  orejas: { tipo: Orejas; tam: number };
  cola: { tipo: Cola; largo: number; grosor: number };
  /** Cuánto abulta el pelaje (1 = pelo corto). */
  esponjoso: number;
  barba?: boolean;
  ojos: string;
  pelaje: {
    cuerpo: string;
    lomo?: string;
    pecho?: string;
    cara?: string;
    hocico?: string;
    orejas?: string;
    patas?: string;
    cola?: string;
    nariz?: string;
  };
};

const PERRO = { ojos: "#2a1a10", especie: "Perro" as const };
const GATO = { ojos: "#8a9a2c", especie: "Gato" as const };

export const RAZAS: Raza[] = [
  { ...PERRO, nombre: "Mestizo", peso: "10–25 kg", tamano: 1, largo: 1, radio: 0.27, patas: { largo: 0.52, grosor: 0.07 }, cabeza: 0.25, hocico: { largo: 0.22, ancho: 0.11 }, orejas: { tipo: "semi", tam: 0.2 }, cola: { tipo: "recta", largo: 0.55, grosor: 0.045 }, esponjoso: 1, pelaje: { cuerpo: "#8a5a33", pecho: "#e6cfa9", hocico: "#6e4526", patas: "#e6cfa9" } },
  { ...PERRO, nombre: "Labrador", peso: "25–36 kg", tamano: 1.12, largo: 1.05, radio: 0.3, patas: { largo: 0.56, grosor: 0.082 }, cabeza: 0.27, hocico: { largo: 0.25, ancho: 0.125 }, orejas: { tipo: "caida", tam: 0.22 }, cola: { tipo: "recta", largo: 0.6, grosor: 0.06 }, esponjoso: 1, pelaje: { cuerpo: "#d9a857", orejas: "#c48f3f" } },
  { ...PERRO, nombre: "Golden Retriever", peso: "25–34 kg", tamano: 1.12, largo: 1.05, radio: 0.3, patas: { largo: 0.58, grosor: 0.078 }, cabeza: 0.27, hocico: { largo: 0.25, ancho: 0.115 }, orejas: { tipo: "caida", tam: 0.24 }, cola: { tipo: "esponjosa", largo: 0.62, grosor: 0.065 }, esponjoso: 1.1, pelaje: { cuerpo: "#c98a3c", pecho: "#dca25a", cola: "#d8a052" } },
  { ...PERRO, nombre: "Poodle", peso: "20–32 kg", tamano: 1, largo: 0.9, radio: 0.25, patas: { largo: 0.7, grosor: 0.062 }, cabeza: 0.24, hocico: { largo: 0.26, ancho: 0.09 }, orejas: { tipo: "caida", tam: 0.26 }, cola: { tipo: "corta", largo: 0.3, grosor: 0.07 }, esponjoso: 1.18, pelaje: { cuerpo: "#f1ebe0", nariz: "#3a2a24" } },
  { ...PERRO, nombre: "Beagle", peso: "9–11 kg", tamano: 0.82, largo: 0.95, radio: 0.27, patas: { largo: 0.45, grosor: 0.07 }, cabeza: 0.26, hocico: { largo: 0.2, ancho: 0.11 }, orejas: { tipo: "caida", tam: 0.28 }, cola: { tipo: "recta", largo: 0.5, grosor: 0.045 }, esponjoso: 1, pelaje: { cuerpo: "#b87838", lomo: "#2b2420", pecho: "#f4efe6", hocico: "#f4efe6", patas: "#f4efe6", cola: "#2b2420", orejas: "#9a5f2a" } },
  { ...PERRO, nombre: "Bulldog Francés", peso: "8–14 kg", tamano: 0.72, largo: 0.78, radio: 0.32, patas: { largo: 0.34, grosor: 0.088 }, cabeza: 0.33, hocico: { largo: 0.07, ancho: 0.15 }, orejas: { tipo: "murcielago", tam: 0.22 }, cola: { tipo: "corta", largo: 0.12, grosor: 0.05 }, esponjoso: 1, pelaje: { cuerpo: "#c4ab8e", hocico: "#3b312b", orejas: "#b39a7c" } },
  { ...PERRO, nombre: "Schnauzer", peso: "6–9 kg", tamano: 0.78, largo: 0.92, radio: 0.26, patas: { largo: 0.52, grosor: 0.064 }, cabeza: 0.25, hocico: { largo: 0.23, ancho: 0.11 }, orejas: { tipo: "semi", tam: 0.18 }, cola: { tipo: "corta", largo: 0.18, grosor: 0.05 }, esponjoso: 1.04, barba: true, pelaje: { cuerpo: "#6c7075", hocico: "#d6d8da", patas: "#b9bcbf", pecho: "#a7abb0" } },
  { ...PERRO, nombre: "Yorkshire", peso: "2–3 kg", tamano: 0.5, largo: 0.85, radio: 0.22, patas: { largo: 0.4, grosor: 0.05 }, cabeza: 0.25, hocico: { largo: 0.13, ancho: 0.08 }, orejas: { tipo: "erecta", tam: 0.15 }, cola: { tipo: "recta", largo: 0.35, grosor: 0.04 }, esponjoso: 1.08, pelaje: { cuerpo: "#465261", cara: "#c9953f", hocico: "#c9953f", pecho: "#c9953f", patas: "#c9953f", orejas: "#c9953f" } },
  { ...PERRO, nombre: "Border Collie", peso: "14–20 kg", tamano: 0.95, largo: 1, radio: 0.26, patas: { largo: 0.56, grosor: 0.066 }, cabeza: 0.25, hocico: { largo: 0.22, ancho: 0.1 }, orejas: { tipo: "semi", tam: 0.19 }, cola: { tipo: "esponjosa", largo: 0.62, grosor: 0.055 }, esponjoso: 1.06, pelaje: { cuerpo: "#1e1e22", pecho: "#f3f1ec", hocico: "#f3f1ec", patas: "#f3f1ec", cola: "#1e1e22" } },
  { ...PERRO, nombre: "Pastor Alemán", peso: "30–40 kg", tamano: 1.18, largo: 1.12, radio: 0.3, patas: { largo: 0.6, grosor: 0.08 }, cabeza: 0.27, hocico: { largo: 0.27, ancho: 0.11 }, orejas: { tipo: "erecta", tam: 0.27 }, cola: { tipo: "esponjosa", largo: 0.68, grosor: 0.06 }, esponjoso: 1.04, pelaje: { cuerpo: "#b27a3c", lomo: "#221d1a", hocico: "#2a2420", cola: "#3a2e24", orejas: "#2a2420" } },
  { ...PERRO, nombre: "Husky Siberiano", peso: "16–27 kg", tamano: 1.04, largo: 1, radio: 0.28, patas: { largo: 0.56, grosor: 0.072 }, cabeza: 0.26, hocico: { largo: 0.22, ancho: 0.11 }, orejas: { tipo: "erecta", tam: 0.2 }, cola: { tipo: "enroscada", largo: 0.6, grosor: 0.065 }, esponjoso: 1.1, ojos: "#5aa0d8", pelaje: { cuerpo: "#5f6773", lomo: "#474e58", pecho: "#f2f2f0", hocico: "#f2f2f0", cara: "#f2f2f0", patas: "#f2f2f0" } },
  { ...PERRO, nombre: "Chihuahua", peso: "1,5–3 kg", tamano: 0.45, largo: 0.8, radio: 0.22, patas: { largo: 0.4, grosor: 0.045 }, cabeza: 0.3, hocico: { largo: 0.1, ancho: 0.08 }, orejas: { tipo: "erecta", tam: 0.27 }, cola: { tipo: "enroscada", largo: 0.4, grosor: 0.035 }, esponjoso: 1, pelaje: { cuerpo: "#d8b489", pecho: "#efdcc0" } },
  { ...GATO, nombre: "Mestizo", peso: "3,5–5 kg", tamano: 0.62, largo: 0.85, radio: 0.2, patas: { largo: 0.42, grosor: 0.048 }, cabeza: 0.2, hocico: { largo: 0.05, ancho: 0.075 }, orejas: { tipo: "felina", tam: 0.13 }, cola: { tipo: "larga", largo: 0.8, grosor: 0.035 }, esponjoso: 1.02, pelaje: { cuerpo: "#9d8166", lomo: "#7a624c", pecho: "#e9dccb", hocico: "#efe4d6", nariz: "#c47b7b" } },
  { ...GATO, nombre: "Siamés", peso: "3–5 kg", tamano: 0.62, largo: 0.88, radio: 0.19, patas: { largo: 0.46, grosor: 0.045 }, cabeza: 0.19, hocico: { largo: 0.07, ancho: 0.07 }, orejas: { tipo: "felina", tam: 0.16 }, cola: { tipo: "larga", largo: 0.85, grosor: 0.03 }, esponjoso: 1, ojos: "#3f7fd0", pelaje: { cuerpo: "#efe3cc", cara: "#4a3a30", hocico: "#3d2f27", orejas: "#3d2f27", patas: "#4a3a30", cola: "#3d2f27", nariz: "#2a211c" } },
  { ...GATO, nombre: "Persa", peso: "3–6 kg", tamano: 0.66, largo: 0.8, radio: 0.22, patas: { largo: 0.34, grosor: 0.055 }, cabeza: 0.23, hocico: { largo: 0.015, ancho: 0.08 }, orejas: { tipo: "felina", tam: 0.09 }, cola: { tipo: "esponjosa", largo: 0.55, grosor: 0.07 }, esponjoso: 1.28, ojos: "#c77b1c", pelaje: { cuerpo: "#f3f1ec", nariz: "#d99a9a" } },
  { ...GATO, nombre: "Maine Coon", peso: "6–9 kg", tamano: 0.82, largo: 1, radio: 0.24, patas: { largo: 0.46, grosor: 0.058 }, cabeza: 0.22, hocico: { largo: 0.07, ancho: 0.085 }, orejas: { tipo: "felina", tam: 0.17 }, cola: { tipo: "esponjosa", largo: 0.85, grosor: 0.075 }, esponjoso: 1.16, pelaje: { cuerpo: "#7a5b42", lomo: "#5a4230", pecho: "#eadfcf", hocico: "#eadfcf", cola: "#6d5039" } },
  { ...GATO, nombre: "Bengalí", peso: "4–7 kg", tamano: 0.66, largo: 0.92, radio: 0.2, patas: { largo: 0.46, grosor: 0.05 }, cabeza: 0.19, hocico: { largo: 0.06, ancho: 0.075 }, orejas: { tipo: "felina", tam: 0.12 }, cola: { tipo: "larga", largo: 0.75, grosor: 0.038 }, esponjoso: 1, ojos: "#6d9a2c", pelaje: { cuerpo: "#cf9550", lomo: "#9c6630", pecho: "#f0dcc0", hocico: "#f0dcc0", cola: "#8a5a2a" } },
];

export function razasDe(especie: Especie): Raza[] {
  return RAZAS.filter((raza) => raza.especie === especie);
}

/** La raza de la ficha; si no está en el catálogo, el mestizo de su especie. */
export function razaDe(especie: string | null | undefined, raza: string | null | undefined): Raza {
  const tipo: Especie = especie === "Gato" ? "Gato" : "Perro";
  return RAZAS.find((item) => item.especie === tipo && item.nombre === raza) ?? RAZAS.find((item) => item.especie === tipo && item.nombre === "Mestizo")!;
}

/** Edad en años (con decimales) a partir de la fecha de nacimiento. */
export function aniosDe(nacimiento: string | null | undefined, ahora = new Date()): number | null {
  if (!nacimiento) return null;
  const nacio = new Date(`${nacimiento}T12:00:00`);
  if (Number.isNaN(nacio.getTime())) return null;
  return (ahora.getTime() - nacio.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

/** Etapa de vida: cambia cómo se dibuja (cachorro de cabeza grande, hocico canoso en el senior). */
export function etapaDe(especie: Especie, anios: number | null): "cachorro" | "adulto" | "senior" {
  if (anios === null) return "adulto";
  if (anios < 1) return "cachorro";
  return anios >= (especie === "Gato" ? 11 : 8) ? "senior" : "adulto";
}
