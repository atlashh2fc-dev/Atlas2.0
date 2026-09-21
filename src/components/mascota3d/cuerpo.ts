import * as THREE from "three";

import type { Raza, Region } from "@/lib/anatomia";

/**
 * El cuerpo de la mascota como un conjunto de formas anatómicas: cada una es
 * una zona clínica (se toca y se marca) y se pinta con el pelaje de su raza. Las
 * del tronco, el cuello, la cabeza y las patas se funden después en una sola
 * piel (ver piel.ts); ojos, nariz, orejas, bigotes y cola se dibujan aparte.
 *
 * Coordenadas del modelo: el animal mira hacia +x, con +y arriba; su lado
 * derecho es +z. Las patas apoyan en y = 0. Las medidas vienen de la raza,
 * relativas al largo del cuerpo.
 */

type V3 = [number, number, number];

export type Parte =
  | { region: Region; forma: "elipsoide"; centro: V3; escala: V3; rotacion?: V3; color: string; material?: "pelo" | "ojo" | "nariz" | "pupila" | "interior" }
  /** Cápsula que puede afinarse de un extremo al otro (radio en `desde`, radio2 en `hasta`). */
  | { region: Region; forma: "capsula"; desde: V3; hasta: V3; radio: number; radio2?: number; color: string }
  | { region: Region; forma: "cono"; centro: V3; radio: number; alto: number; rotacion: V3; aplanado?: number; color: string; material?: "pelo" | "interior" }
  | { region: Region; forma: "cola"; puntos: V3[]; radio: number; color: string }
  | { region: Region; forma: "bigote"; desde: V3; hasta: V3; color: string };

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
  const interiorOreja = mezclar(p.orejas ?? cara, "#e7a3a0", 0.55);

  const mitad = L / 2;
  const yT = pl + R * 0.72;
  const partes: Parte[] = [];

  // Tronco: tórax con la quilla del pecho, abdomen recogido hacia atrás, cadera y lomo.
  partes.push({ region: "torax", forma: "elipsoide", centro: [mitad * 0.42, yT, 0], escala: [R * 1.14, R * 1.1, R * 0.96], color: cuerpo });
  partes.push({ region: "torax", forma: "elipsoide", centro: [mitad * 0.52, yT - R * 0.42, 0], escala: [R * 0.8, R * 0.7, R * 0.74], color: pecho });
  partes.push({ region: "torax", forma: "elipsoide", centro: [mitad * 0.64, yT - R * 0.2, 0], escala: [R * 0.62, R * 0.62, R * 0.66], color: pecho });
  partes.push({ region: "abdomen", forma: "elipsoide", centro: [-mitad * 0.04, yT - R * 0.02, 0], escala: [mitad * 0.8, R * 0.84, R * 0.86], color: cuerpo });
  partes.push({ region: "abdomen", forma: "elipsoide", centro: [mitad * 0.12, yT - R * 0.36, 0], escala: [mitad * 0.46, R * 0.52, R * 0.66], color: pecho });
  partes.push({ region: "cadera", forma: "elipsoide", centro: [-mitad * 0.52, yT + R * 0.06, 0], escala: [R * 1.0, R * 0.96, R * 0.92], color: cuerpo });
  partes.push({ region: "lomo", forma: "elipsoide", centro: [-mitad * 0.05, yT + R * 0.45, 0], escala: [mitad * 0.98, R * 0.6, R * 0.76], color: cuerpo });

  // Cabeza: cráneo, frente (el "stop"), mejillas; y el cuello que la une.
  const hx = mitad * 0.62 + R * 0.62 + cab * 0.5;
  const hy = yT + R * 0.95 + cab * (gato ? 0.45 : 0.55);
  partes.push({ region: "cuello", forma: "capsula", desde: [mitad * 0.52, yT + R * 0.25, 0], hasta: [hx - cab * 0.45, hy - cab * 0.35, 0], radio: R * (gato ? 0.56 : 0.64), radio2: R * (gato ? 0.46 : 0.5), color: p.lomo && !gato ? mezclar(cuerpo, p.lomo, 0.25) : cuerpo });
  partes.push({ region: "cabeza", forma: "elipsoide", centro: [hx - cab * 0.08, hy + cab * 0.06, 0], escala: [cab * 0.98, cab * 0.9, cab * 0.86], color: cara });
  partes.push({ region: "cabeza", forma: "elipsoide", centro: [hx + cab * 0.3, hy + cab * 0.32, 0], escala: [cab * 0.4, cab * 0.34, cab * 0.44], color: cara });
  for (const lado of [1, -1]) {
    partes.push({ region: "cabeza", forma: "elipsoide", centro: [hx + cab * 0.22, hy - cab * 0.22, lado * cab * 0.4], escala: [cab * 0.44, cab * 0.36, cab * 0.32], color: gato ? hocicoColor : cara });
  }

  // Hocico: se afina hacia la trufa en los perros de hocico largo; bloque corto en los braquicéfalos; almohadillas en los gatos.
  const { largo: hl, ancho: ha } = raza.hocico;
  let punta: V3;
  let almohadilla: V3 | null = null;
  if (gato) {
    for (const lado of [1, -1]) {
      partes.push({ region: "boca", forma: "elipsoide", centro: [hx + cab * 0.72, hy - cab * 0.3, lado * cab * 0.17], escala: [cab * 0.2 + hl, cab * 0.19, cab * 0.21], color: hocicoColor });
    }
    partes.push({ region: "boca", forma: "elipsoide", centro: [hx + cab * 0.66, hy - cab * 0.48, 0], escala: [cab * 0.19, cab * 0.11, cab * 0.17], color: hocicoColor });
    punta = [hx + cab * 0.86 + hl, hy - cab * 0.15, 0];
    almohadilla = [hx + cab * 0.8 + hl, hy - cab * 0.3, cab * 0.17];
    partes.push({ region: "boca", forma: "elipsoide", centro: punta, escala: [cab * 0.07, cab * 0.06, cab * 0.09], color: p.nariz ?? "#c98282", material: "nariz" });
  } else if (hl < 0.1) {
    const cx = hx + cab * 0.7;
    partes.push({ region: "boca", forma: "elipsoide", centro: [cx, hy - cab * 0.28, 0], escala: [hl + cab * 0.2, ha, ha * 1.25], color: hocicoColor });
    partes.push({ region: "boca", forma: "elipsoide", centro: [cx - cab * 0.03, hy - cab * 0.52, 0], escala: [hl + cab * 0.15, ha * 0.55, ha], color: hocicoColor });
    punta = [cx + hl + cab * 0.18, hy - cab * 0.15, 0];
    partes.push({ region: "boca", forma: "elipsoide", centro: punta, escala: [ha * 0.4, ha * 0.34, ha * 0.62], color: p.nariz ?? "#1c1714", material: "nariz" });
  } else {
    const desde: V3 = [hx + cab * 0.42, hy - cab * 0.16, 0];
    const hasta: V3 = [hx + cab * 0.42 + hl, hy - cab * 0.3, 0];
    partes.push({ region: "boca", forma: "capsula", desde, hasta, radio: ha * 1.22, radio2: ha * 0.86, color: hocicoColor });
    partes.push({ region: "boca", forma: "capsula", desde: [hx + cab * 0.3, hy - cab * 0.44, 0], hasta: [hasta[0] - ha * 0.45, hasta[1] - ha * 0.6, 0], radio: ha * 0.78, radio2: ha * 0.5, color: hocicoColor });
    punta = [hasta[0] + ha * 0.72, hasta[1] + ha * 0.22, 0];
    partes.push({ region: "boca", forma: "elipsoide", centro: punta, escala: [ha * 0.44, ha * 0.36, ha * 0.6], color: p.nariz ?? "#1c1714", material: "nariz" });
    if (raza.barba) {
      partes.push({ region: "boca", forma: "elipsoide", centro: [hx + cab * 0.42 + hl * 0.55, hy - cab * 0.6, 0], escala: [hl * 0.62, cab * 0.3, ha * 1.15], color: hocicoColor });
    }
  }

  // Ojos (iris, pupila) con el párpado encima, que da la expresión.
  for (const lado of [1, -1]) {
    // Los ojos asoman de la superficie del cráneo: si quedan adentro, el pelo los tapa.
    const ojo: V3 = [hx + cab * 0.72, hy + cab * 0.12, lado * cab * 0.45];
    partes.push({ region: "ojos", forma: "elipsoide", centro: ojo, escala: [cab * 0.13, cab * (gato ? 0.14 : 0.125), cab * 0.13], color: raza.ojos, material: "ojo" });
    partes.push({ region: "ojos", forma: "elipsoide", centro: [ojo[0] + cab * 0.085, ojo[1], ojo[2] + lado * cab * 0.035], escala: [cab * 0.045, cab * (gato ? 0.09 : 0.07), cab * (gato ? 0.03 : 0.07)], color: "#070505", material: "pupila" });
    partes.push({ region: "ojos", forma: "elipsoide", centro: [ojo[0] - cab * 0.03, ojo[1] + cab * 0.1, ojo[2] * 0.98], escala: [cab * 0.15, cab * 0.05, cab * 0.13], color: cara });
  }

  // Orejas planas, con el interior de otro tono.
  const tamOreja = raza.orejas.tam * (cachorro ? 1.1 : 1);
  const colorOreja = p.orejas ?? cara;
  for (const lado of [1, -1]) {
    const base: V3 = [hx - cab * 0.14, hy + cab * 0.7, lado * cab * 0.48];
    const tipo = raza.orejas.tipo;
    if (tipo === "caida") {
      // La oreja caída cuelga pegada a la mejilla, apenas separada de la cabeza.
      partes.push({ region: "oidos", forma: "elipsoide", centro: [hx - cab * 0.16, hy - cab * 0.22, lado * cab * 0.8], escala: [tamOreja * 0.46, tamOreja * 1.0, tamOreja * 0.11], rotacion: [-lado * 0.08, 0, 0.14], color: colorOreja });
      continue;
    }
    const ajustes: Record<Exclude<typeof tipo, "caida">, { alto: number; radio: number; rotacion: V3; subir: number; adelantar: number }> = {
      erecta: { alto: 1, radio: 0.42, rotacion: [lado * 0.24, 0, 0.12], subir: 0.42, adelantar: 0 },
      semi: { alto: 1, radio: 0.44, rotacion: [lado * 0.3, 0, -0.95], subir: 0.25, adelantar: 0.15 },
      murcielago: { alto: 1.05, radio: 0.58, rotacion: [lado * 0.42, 0, 0.05], subir: 0.42, adelantar: 0 },
      felina: { alto: 0.95, radio: 0.55, rotacion: [lado * 0.3, 0, 0.08], subir: 0.35, adelantar: 0.02 },
    };
    const a = ajustes[tipo];
    const centro: V3 = [base[0] + tamOreja * a.adelantar, base[1] + tamOreja * a.subir, base[2]];
    partes.push({ region: "oidos", forma: "cono", centro, radio: tamOreja * a.radio, alto: tamOreja * a.alto, rotacion: a.rotacion, aplanado: 0.42, color: colorOreja });
    partes.push({ region: "oidos", forma: "cono", centro: [centro[0] + tamOreja * 0.07, centro[1] - tamOreja * 0.06, centro[2]], radio: tamOreja * a.radio * 0.7, alto: tamOreja * a.alto * 0.8, rotacion: a.rotacion, aplanado: 0.3, color: interiorOreja, material: "interior" });
  }

  // Bigotes de los gatos.
  if (almohadilla) {
    for (const lado of [1, -1]) {
      for (let i = 0; i < 4; i += 1) {
        const [ax, ay, az] = almohadilla;
        partes.push({ region: "boca", forma: "bigote", desde: [ax, ay - i * cab * 0.035, lado * az], hasta: [ax + cab * 0.35, ay + cab * (0.12 - i * 0.1), lado * (az + cab * 0.95)], color: "#f4f2ec" });
      }
    }
  }

  // Patas articuladas. Delanteras: hombro, brazo, codo, antebrazo, carpo y mano.
  // Traseras: muslo, rodilla, tibia, corvejón y pie. Con dedos.
  const centrosPatas: Partial<Record<Region, V3>> = {};
  const ponerMano = (region: Region, x: number, z: number) => {
    partes.push({ region, forma: "elipsoide", centro: [x + g * 0.7, g * 0.62, z], escala: [g * 1.22, g * 0.6, g * 1.02], color: patasColor });
    for (const dz of [-0.95, -0.33, 0.33, 0.95]) {
      partes.push({ region, forma: "elipsoide", centro: [x + g * (1.75 - Math.abs(dz) * 0.35), g * 0.44, z + dz * g * 0.55], escala: [g * 0.4, g * 0.36, g * 0.32], color: patasColor });
    }
  };
  for (const lado of [1, -1]) {
    const z = lado * R * 0.6;
    {
      const region = `pata_delantera_${lado === 1 ? "derecha" : "izquierda"}` as Region;
      const x = mitad * 0.54;
      const hombro: V3 = [x + R * 0.08, yT - R * 0.18, z];
      const codo: V3 = [x - R * 0.14, pl * 0.64, z];
      const carpo: V3 = [x - R * 0.04, pl * 0.2, z];
      const mano: V3 = [x + g * 0.3, g * 0.8, z];
      partes.push({ region, forma: "elipsoide", centro: [x - R * 0.02, yT + R * 0.12, z * 1.06], escala: [R * 0.42, R * 0.62, R * 0.3], color: cuerpo });
      partes.push({ region, forma: "capsula", desde: hombro, hasta: codo, radio: g * 1.45, radio2: g * 1.08, color: cuerpo });
      partes.push({ region, forma: "capsula", desde: codo, hasta: carpo, radio: g * 1.0, radio2: g * 0.76, color: patasColor });
      partes.push({ region, forma: "capsula", desde: carpo, hasta: mano, radio: g * 0.76, radio2: g * 0.72, color: patasColor });
      ponerMano(region, mano[0], z);
      centrosPatas[region] = [codo[0] + g * 0.4, (codo[1] + carpo[1]) / 2, z + lado * g * 1.5];
    }
    {
      const region = `pata_trasera_${lado === 1 ? "derecha" : "izquierda"}` as Region;
      const x = -mitad * 0.5;
      const cadera: V3 = [x + 0.01, yT - R * 0.12, z];
      const rodilla: V3 = [x + R * 0.3, pl * 0.58, z];
      const corvejon: V3 = [x - R * 0.2, pl * 0.26, z];
      const pie: V3 = [x - R * 0.1, g * 0.8, z];
      partes.push({ region, forma: "elipsoide", centro: [x + 0.02, yT - R * 0.2, z * 1.1], escala: [R * 0.66, R * 0.82, R * 0.38], color: cuerpo });
      partes.push({ region, forma: "capsula", desde: cadera, hasta: rodilla, radio: g * 1.6, radio2: g * 1.1, color: cuerpo });
      partes.push({ region, forma: "capsula", desde: rodilla, hasta: corvejon, radio: g * 1.05, radio2: g * 0.72, color: patasColor });
      partes.push({ region, forma: "capsula", desde: corvejon, hasta: pie, radio: g * 0.72, radio2: g * 0.7, color: patasColor });
      ponerMano(region, pie[0], z);
      centrosPatas[region] = [rodilla[0] + g * 0.5, rodilla[1], z + lado * g * 1.6];
    }
  }

  // Cola.
  const c = raza.cola.largo;
  const base: V3 = [-mitad * 0.97 - R * 0.06, yT + R * 0.38, 0];
  const recorridos: Record<Raza["cola"]["tipo"], [number, number][]> = {
    recta: [[0, 0], [-0.25, 0.14], [-0.55, 0.22], [-0.82, 0.14], [-1, 0]],
    esponjosa: [[0, 0], [-0.28, -0.04], [-0.58, -0.12], [-0.84, -0.08], [-1, 0.03]],
    enroscada: [[0, 0], [-0.12, 0.26], [-0.02, 0.5], [0.18, 0.46], [0.24, 0.28]],
    corta: [[0, 0], [-0.5, 0.25], [-1, 0.38]],
    larga: [[0, 0], [-0.3, -0.06], [-0.55, 0.1], [-0.64, 0.44], [-0.55, 0.74]],
  };
  const colaPuntos = recorridos[raza.cola.tipo].map(([dx, dy]) => [base[0] + dx * c, base[1] + dy * c, 0] as V3);
  // La cola va en la piel, como una cadena de tramos que se afinan hacia la punta: así lleva pelo.
  const radioCola = raza.cola.grosor * f * (raza.cola.tipo === "esponjosa" ? 1.35 : 1);
  const curvaCola = new THREE.CatmullRomCurve3(colaPuntos.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, "centripetal");
  const tramos = 8;
  for (let i = 0; i < tramos; i += 1) {
    const a = curvaCola.getPointAt(i / tramos);
    const b = curvaCola.getPointAt((i + 1) / tramos);
    const r1 = Math.max(0.018, radioCola * (1 - 0.6 * (i / tramos) ** 1.2));
    const r2 = Math.max(0.016, radioCola * (1 - 0.6 * ((i + 1) / tramos) ** 1.2));
    partes.push({ region: "cola", forma: "capsula", desde: [a.x, a.y, a.z], hasta: [b.x, b.y, b.z], radio: r1, radio2: r2, color: p.cola ?? cuerpo });
  }

  const centros: Record<Region, V3> = {
    cabeza: [hx - cab * 0.1, hy + cab * 0.9, cab * 0.2],
    ojos: [hx + cab * 0.76, hy + cab * 0.16, cab * 0.48],
    oidos: [hx - cab * 0.14, hy + cab * 0.95, cab * 0.55],
    boca: [punta[0], punta[1] + cab * 0.1, cab * 0.12],
    cuello: [(mitad * 0.52 + hx) / 2, (yT + hy) / 2 + R * 0.35, R * 0.45],
    torax: [mitad * 0.45, yT, R * 1.0],
    abdomen: [0, yT - R * 0.42, R * 0.8],
    lomo: [0, yT + R * 1.0, 0],
    cadera: [-mitad * 0.52, yT + R * 0.4, R * 0.88],
    pata_delantera_derecha: centrosPatas.pata_delantera_derecha!,
    pata_delantera_izquierda: centrosPatas.pata_delantera_izquierda!,
    pata_trasera_derecha: centrosPatas.pata_trasera_derecha!,
    pata_trasera_izquierda: centrosPatas.pata_trasera_izquierda!,
    cola: colaPuntos[Math.floor(colaPuntos.length / 2)],
    piel: [-mitad * 0.25, yT + R * 0.6, R * 0.78],
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
