import * as THREE from "three";

import type { Raza, Region } from "@/lib/anatomia";

/**
 * El cuerpo de la mascota como un conjunto de formas suaves: cada una es una
 * zona clínica (se toca y se marca) y se pinta con el pelaje de su raza.
 *
 * Coordenadas del modelo: el animal mira hacia +x, con +y arriba; su lado
 * derecho es +z. Las patas apoyan en y = 0. Las medidas vienen de la raza,
 * relativas al largo del cuerpo.
 */

type V3 = [number, number, number];

export type Parte =
  | { region: Region; forma: "elipsoide"; centro: V3; escala: V3; rotacion?: V3; color: string; material?: "pelo" | "ojo" | "nariz" | "pupila" }
  | { region: Region; forma: "capsula"; desde: V3; hasta: V3; radio: number; color: string }
  | { region: Region; forma: "cono"; centro: V3; radio: number; alto: number; rotacion: V3; color: string }
  | { region: Region; forma: "cola"; puntos: V3[]; radio: number; color: string };

export type Manto = { color: string; y0: number; y1: number; x0: number; x1: number };

export type Cuerpo = {
  partes: Parte[];
  /** Manto del dorso (beagle, pastor alemán, husky...): se pinta por altura sobre el tronco. */
  manto: Manto | null;
  /** Dónde va el marcador de una zona cuando el registro no trae un punto. */
  centros: Record<Region, V3>;
  alto: number;
  largo: number;
};

const mezclar = (a: string, b: string, t: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

export function construirCuerpo(raza: Raza, etapa: "cachorro" | "adulto" | "senior"): Cuerpo {
  const cachorro = etapa === "cachorro";
  const f = raza.esponjoso;
  const L = raza.largo * (cachorro ? 0.88 : 1);
  const R = raza.radio * f;
  const pl = raza.patas.largo * (cachorro ? 0.86 : 1);
  const g = raza.patas.grosor * Math.sqrt(f);
  const cab = raza.cabeza * (cachorro ? 1.22 : 1);
  const gato = raza.especie === "Gato";
  const p = raza.pelaje;
  const cuerpo = p.cuerpo;
  const cara = p.cara ?? cuerpo;
  const hocicoColor = etapa === "senior" ? mezclar(p.hocico ?? cara, "#d9d9d6", 0.55) : p.hocico ?? cara;
  const pecho = p.pecho ?? cuerpo;
  const patasColor = p.patas ?? cuerpo;

  const mitad = L / 2;
  const yT = pl + R * 0.72;
  const partes: Parte[] = [];

  // Tronco: tórax, abdomen, cadera y el lomo encima (donde suele ir el manto).
  partes.push({ region: "torax", forma: "elipsoide", centro: [mitad * 0.42, yT, 0], escala: [R * 1.12, R * 1.08, R * 0.98], color: cuerpo });
  partes.push({ region: "torax", forma: "elipsoide", centro: [mitad * 0.52, yT - R * 0.38, 0], escala: [R * 0.8, R * 0.66, R * 0.76], color: pecho });
  partes.push({ region: "abdomen", forma: "elipsoide", centro: [-mitad * 0.02, yT - R * 0.06, 0], escala: [mitad * 0.8, R * 0.9, R * 0.9], color: cuerpo });
  partes.push({ region: "abdomen", forma: "elipsoide", centro: [0, yT - R * 0.4, 0], escala: [mitad * 0.58, R * 0.55, R * 0.72], color: pecho });
  partes.push({ region: "cadera", forma: "elipsoide", centro: [-mitad * 0.5, yT + R * 0.03, 0], escala: [R * 1.02, R * 1.0, R * 0.95], color: cuerpo });
  // El lomo cubre la mitad de arriba del tronco: ahí va el manto de las razas que lo tienen.
  partes.push({ region: "lomo", forma: "elipsoide", centro: [-mitad * 0.05, yT + R * 0.45, 0], escala: [mitad * 0.98, R * 0.6, R * 0.78], color: cuerpo });

  // Cabeza y cuello.
  const hx = mitad * 0.62 + R * 0.62 + cab * 0.5;
  const hy = yT + R * 0.95 + cab * (gato ? 0.45 : 0.55);
  partes.push({ region: "cuello", forma: "capsula", desde: [mitad * 0.55, yT + R * 0.3, 0], hasta: [hx - cab * 0.4, hy - cab * 0.3, 0], radio: R * (gato ? 0.5 : 0.56), color: p.lomo && !gato ? mezclar(cuerpo, p.lomo, 0.3) : cuerpo });
  partes.push({ region: "cabeza", forma: "elipsoide", centro: [hx, hy, 0], escala: [cab * 1.04, cab * 0.94, cab * 0.92], color: cara });

  // Hocico: capsula en los perros de hocico largo, un bloque corto en los braquicéfalos, almohadillas en los gatos.
  const { largo: hl, ancho: ha } = raza.hocico;
  let punta: V3;
  if (gato) {
    for (const lado of [1, -1]) {
      partes.push({ region: "boca", forma: "elipsoide", centro: [hx + cab * 0.74, hy - cab * 0.32, lado * cab * 0.17], escala: [cab * 0.2 + hl, cab * 0.2, cab * 0.21], color: hocicoColor });
    }
    partes.push({ region: "boca", forma: "elipsoide", centro: [hx + cab * 0.68, hy - cab * 0.5, 0], escala: [cab * 0.2, cab * 0.12, cab * 0.18], color: hocicoColor });
    punta = [hx + cab * 0.88 + hl, hy - cab * 0.16, 0];
    partes.push({ region: "boca", forma: "elipsoide", centro: punta, escala: [cab * 0.07, cab * 0.06, cab * 0.09], color: p.nariz ?? "#c98282", material: "nariz" });
  } else if (hl < 0.1) {
    const cx = hx + cab * 0.72;
    partes.push({ region: "boca", forma: "elipsoide", centro: [cx, hy - cab * 0.3, 0], escala: [hl + cab * 0.2, ha, ha * 1.25], color: hocicoColor });
    partes.push({ region: "boca", forma: "elipsoide", centro: [cx - cab * 0.02, hy - cab * 0.52, 0], escala: [hl + cab * 0.15, ha * 0.55, ha], color: hocicoColor });
    punta = [cx + hl + cab * 0.18, hy - cab * 0.16, 0];
    partes.push({ region: "boca", forma: "elipsoide", centro: punta, escala: [ha * 0.4, ha * 0.34, ha * 0.62], color: p.nariz ?? "#1c1714", material: "nariz" });
  } else {
    const desde: V3 = [hx + cab * 0.45, hy - cab * 0.24, 0];
    const hasta: V3 = [hx + cab * 0.45 + hl, hy - cab * 0.32, 0];
    partes.push({ region: "boca", forma: "capsula", desde, hasta, radio: ha, color: hocicoColor });
    // Mandíbula.
    partes.push({ region: "boca", forma: "capsula", desde: [hx + cab * 0.35, hy - cab * 0.46, 0], hasta: [hasta[0] - ha * 0.4, hasta[1] - ha * 0.55, 0], radio: ha * 0.62, color: hocicoColor });
    punta = [hasta[0] + ha * 0.78, hasta[1] + ha * 0.28, 0];
    partes.push({ region: "boca", forma: "elipsoide", centro: punta, escala: [ha * 0.42, ha * 0.36, ha * 0.58], color: p.nariz ?? "#1c1714", material: "nariz" });
    if (raza.barba) {
      partes.push({ region: "boca", forma: "elipsoide", centro: [hx + cab * 0.45 + hl * 0.55, hy - cab * 0.62, 0], escala: [hl * 0.62, cab * 0.3, ha * 1.15], color: hocicoColor });
    }
  }

  // Ojos: el iris con el color de la raza y la pupila por delante.
  for (const lado of [1, -1]) {
    const ojo: V3 = [hx + cab * 0.7, hy + cab * 0.14, lado * cab * 0.42];
    partes.push({ region: "ojos", forma: "elipsoide", centro: ojo, escala: [cab * 0.13, cab * 0.13, cab * 0.13], color: raza.ojos, material: "ojo" });
    partes.push({ region: "ojos", forma: "elipsoide", centro: [ojo[0] + cab * 0.07, ojo[1], ojo[2] + lado * cab * 0.035], escala: [cab * 0.05, cab * (gato ? 0.09 : 0.075), cab * (gato ? 0.035 : 0.075)], color: "#080606", material: "pupila" });
  }

  // Orejas según su tipo.
  const tamOreja = raza.orejas.tam * (cachorro ? 1.1 : 1);
  const colorOreja = p.orejas ?? cara;
  for (const lado of [1, -1]) {
    const base: V3 = [hx - cab * 0.12, hy + cab * 0.72, lado * cab * 0.5];
    switch (raza.orejas.tipo) {
      case "caida":
        partes.push({ region: "oidos", forma: "elipsoide", centro: [hx - cab * 0.12, hy - cab * 0.05, lado * cab * 0.93], escala: [tamOreja * 0.5, tamOreja * 1.02, tamOreja * 0.13], rotacion: [lado * 0.12, 0, 0.18], color: colorOreja });
        break;
      case "semi":
        partes.push({ region: "oidos", forma: "cono", centro: [base[0] + tamOreja * 0.15, base[1] + tamOreja * 0.25, base[2]], radio: tamOreja * 0.42, alto: tamOreja, rotacion: [lado * 0.3, 0, -0.95], color: colorOreja });
        break;
      case "murcielago":
        partes.push({ region: "oidos", forma: "cono", centro: [base[0], base[1] + tamOreja * 0.42, base[2] * 1.05], radio: tamOreja * 0.55, alto: tamOreja * 1.05, rotacion: [lado * 0.45, 0, 0.05], color: colorOreja });
        break;
      case "felina":
        partes.push({ region: "oidos", forma: "cono", centro: [base[0] + cab * 0.02, base[1] + tamOreja * 0.35, base[2] * 0.92], radio: tamOreja * 0.52, alto: tamOreja * 0.95, rotacion: [lado * 0.32, 0, 0.08], color: colorOreja });
        break;
      default:
        partes.push({ region: "oidos", forma: "cono", centro: [base[0], base[1] + tamOreja * 0.42, base[2]], radio: tamOreja * 0.38, alto: tamOreja, rotacion: [lado * 0.24, 0, 0.12], color: colorOreja });
    }
  }

  // Patas: brazo o muslo, antebrazo o pierna, y la mano o pie.
  const centrosPatas: Partial<Record<Region, V3>> = {};
  for (const delantera of [true, false]) {
    for (const lado of [1, -1]) {
      const region = `pata_${delantera ? "delantera" : "trasera"}_${lado === 1 ? "derecha" : "izquierda"}` as Region;
      const x = delantera ? mitad * 0.52 : -mitad * 0.5;
      const z = lado * R * 0.62;
      const rodilla: V3 = [x + (delantera ? 0.005 : 0.05), pl * 0.52, z];
      const pie: V3 = [x + (delantera ? 0.02 : -0.02), g * 0.9, z];
      if (!delantera) {
        partes.push({ region, forma: "elipsoide", centro: [x + 0.02, yT - R * 0.22, z * 1.08], escala: [R * 0.55, R * 0.72, R * 0.36], color: cuerpo });
      }
      partes.push({ region, forma: "capsula", desde: [x, yT - R * (delantera ? 0.35 : 0.2), z], hasta: rodilla, radio: g * (delantera ? 1.3 : 1.55), color: delantera ? cuerpo : cuerpo });
      partes.push({ region, forma: "capsula", desde: rodilla, hasta: pie, radio: g, color: patasColor });
      partes.push({ region, forma: "elipsoide", centro: [pie[0] + g * 0.45, g * 0.72, z], escala: [g * 1.55, g * 0.82, g * 1.22], color: patasColor });
      centrosPatas[region] = [rodilla[0] + g * 0.6, rodilla[1], z + lado * g * 1.4];
    }
  }

  // Cola.
  const c = raza.cola.largo;
  const base: V3 = [-mitad * 0.95 - R * 0.08, yT + R * 0.36, 0];
  const recorridos: Record<Raza["cola"]["tipo"], [number, number][]> = {
    recta: [[0, 0], [-0.25, 0.14], [-0.55, 0.22], [-0.82, 0.14], [-1, 0]],
    esponjosa: [[0, 0], [-0.28, -0.04], [-0.58, -0.12], [-0.84, -0.08], [-1, 0.03]],
    enroscada: [[0, 0], [-0.12, 0.26], [-0.02, 0.5], [0.18, 0.46], [0.24, 0.28]],
    corta: [[0, 0], [-0.5, 0.25], [-1, 0.38]],
    larga: [[0, 0], [-0.3, -0.06], [-0.55, 0.1], [-0.64, 0.44], [-0.55, 0.74]],
  };
  const colaPuntos = recorridos[raza.cola.tipo].map(([dx, dy]) => [base[0] + dx * c, base[1] + dy * c, 0] as V3);
  partes.push({ region: "cola", forma: "cola", puntos: colaPuntos, radio: raza.cola.grosor * f * (raza.cola.tipo === "esponjosa" ? 1.5 : 1), color: p.cola ?? cuerpo });

  const centros: Record<Region, V3> = {
    cabeza: [hx - cab * 0.1, hy + cab * 0.9, cab * 0.2],
    ojos: [hx + cab * 0.78, hy + cab * 0.18, cab * 0.5],
    oidos: [hx - cab * 0.12, hy + cab * 0.95, cab * 0.55],
    boca: [punta[0], punta[1] + cab * 0.1, cab * 0.12],
    cuello: [(mitad * 0.55 + hx) / 2, (yT + hy) / 2 + R * 0.35, R * 0.4],
    torax: [mitad * 0.45, yT, R * 1.0],
    abdomen: [0, yT - R * 0.45, R * 0.82],
    lomo: [0, yT + R * 0.95, 0],
    cadera: [-mitad * 0.5, yT + R * 0.35, R * 0.9],
    pata_delantera_derecha: centrosPatas.pata_delantera_derecha!,
    pata_delantera_izquierda: centrosPatas.pata_delantera_izquierda!,
    pata_trasera_derecha: centrosPatas.pata_trasera_derecha!,
    pata_trasera_izquierda: centrosPatas.pata_trasera_izquierda!,
    cola: colaPuntos[Math.floor(colaPuntos.length / 2)],
    piel: [-mitad * 0.25, yT + R * 0.55, R * 0.8],
  };

  const manto: Manto | null = p.lomo
    ? { color: p.lomo, y0: yT - R * 0.3, y1: yT + R * 0.5, x0: -mitad * 0.98 - R * 0.3, x1: mitad * 0.66 }
    : null;

  return { partes, manto, centros, alto: hy + cab, largo: L + c * 0.8 };
}

/** Tubo que se afina hacia la punta, para la cola. */
export function geometriaCola(puntos: V3[], radio: number): THREE.BufferGeometry {
  const curva = new THREE.CatmullRomCurve3(puntos.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, "centripetal");
  const segmentos = 48;
  const radiales = 18;
  const geometria = new THREE.TubeGeometry(curva, segmentos, radio, radiales, false);
  const posiciones = geometria.getAttribute("position");
  const centro = new THREE.Vector3();
  const punto = new THREE.Vector3();
  for (let i = 0; i < posiciones.count; i += 1) {
    const anillo = Math.floor(i / (radiales + 1));
    const t = anillo / segmentos;
    curva.getPointAt(Math.min(1, t), centro);
    punto.fromBufferAttribute(posiciones, i).sub(centro).multiplyScalar(1 - 0.62 * t ** 1.3).add(centro);
    posiciones.setXYZ(i, punto.x, punto.y, punto.z);
  }
  geometria.computeVertexNormals();
  return geometria;
}
