import * as THREE from "three";

import { REGIONES, type Region } from "@/lib/anatomia";

import type { Parte } from "./cuerpo";

/**
 * Un modelo realista (.glb hecho con IA) puesto en el lugar del procedural.
 *
 * El motor entrega el animal en cualquier orientación y escala. Aquí se
 * endereza: se busca su eje largo, se gira para que mire hacia +x (la cabeza es
 * el extremo más alto), se apoya en y = 0 y se escala al largo del cuerpo
 * procedural de su raza. Con eso cae encima de las mismas formas, y cada vértice
 * toma la zona clínica de la forma más cercana: los clics, el resaltado y los
 * marcadores siguen funcionando como antes.
 */

type V3 = [number, number, number];

/** Qué fracción del largo cuenta como "punta" para saber hacia dónde mira. */
const PUNTA = 0.3;
/** Desde qué altura (fracción del alto) se busca la cabeza. */
const ALTO_CABEZA = 0.72;

/** Distancia aproximada (con signo) de un punto a una forma del cuerpo procedural. */
function distanciaA(parte: Parte, x: number, y: number, z: number): number {
  const segmento = (a: V3, b: V3, r1: number, r2: number) => {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const largo2 = abx * abx + aby * aby + abz * abz || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / largo2));
    return Math.hypot(x - a[0] - abx * t, y - a[1] - aby * t, z - a[2] - abz * t) - (r1 + (r2 - r1) * t);
  };
  switch (parte.forma) {
    case "elipsoide": {
      const [cx, cy, cz] = parte.centro;
      const [rx, ry, rz] = parte.escala;
      const k = Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz);
      return (k - 1) * Math.min(rx, ry, rz);
    }
    case "capsula":
      return segmento(parte.desde, parte.hasta, parte.radio, parte.radio2 ?? parte.radio);
    case "cono":
      return Math.hypot(x - parte.centro[0], y - parte.centro[1], z - parte.centro[2]) - Math.max(parte.radio, parte.alto / 2);
    case "cola": {
      let menor = Infinity;
      for (let i = 0; i < parte.puntos.length - 1; i += 1) menor = Math.min(menor, segmento(parte.puntos[i], parte.puntos[i + 1], parte.radio, parte.radio));
      return menor;
    }
    default:
      return Infinity;
  }
}

function cajaDe(partes: Parte[]) {
  const caja = new THREE.Box3();
  const punto = new THREE.Vector3();
  for (const parte of partes) {
    if (parte.forma === "elipsoide") {
      caja.expandByPoint(punto.set(parte.centro[0] - parte.escala[0], parte.centro[1] - parte.escala[1], parte.centro[2] - parte.escala[2]));
      caja.expandByPoint(punto.set(parte.centro[0] + parte.escala[0], parte.centro[1] + parte.escala[1], parte.centro[2] + parte.escala[2]));
    } else if (parte.forma === "capsula") {
      for (const extremo of [parte.desde, parte.hasta]) {
        caja.expandByPoint(punto.set(extremo[0] - parte.radio, extremo[1] - parte.radio, extremo[2] - parte.radio));
        caja.expandByPoint(punto.set(extremo[0] + parte.radio, extremo[1] + parte.radio, extremo[2] + parte.radio));
      }
    }
  }
  return caja;
}

export type ModeloEnderezado = {
  /** Mallas ya en coordenadas del modelo procedural, con su zona por vértice. */
  mallas: { geometria: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; regiones: Int8Array }[];
  /** Triángulos de una zona, para pintarla encima del modelo. */
  zona: (region: Region) => THREE.BufferGeometry[];
  dispose: () => void;
};

export function enderezarModelo(escena: THREE.Object3D, partes: Parte[], giroManual: number): ModeloEnderezado {
  escena.updateMatrixWorld(true);
  const fuentes: { geometria: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[] = [];
  escena.traverse((objeto) => {
    const malla = objeto as THREE.Mesh;
    if (!malla.isMesh) return;
    const geometria = malla.geometry.clone();
    geometria.applyMatrix4(malla.matrixWorld);
    fuentes.push({ geometria, material: malla.material });
  });

  // Eje largo en el plano del piso (análisis de componentes principales sobre x, z).
  let n = 0;
  let mx = 0;
  let mz = 0;
  for (const { geometria } of fuentes) {
    const pos = geometria.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) {
      mx += pos.getX(i);
      mz += pos.getZ(i);
      n += 1;
    }
  }
  mx /= n || 1;
  mz /= n || 1;
  let cxx = 0;
  let czz = 0;
  let cxz = 0;
  for (const { geometria } of fuentes) {
    const pos = geometria.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) {
      const dx = pos.getX(i) - mx;
      const dz = pos.getZ(i) - mz;
      cxx += dx * dx;
      czz += dz * dz;
      cxz += dx * dz;
    }
  }
  const angulo = 0.5 * Math.atan2(2 * cxz, cxx - czz);
  const enderezar = new THREE.Matrix4().makeRotationY(angulo);
  for (const { geometria } of fuentes) geometria.applyMatrix4(enderezar);

  // La cabeza va adelante. Se mira solo lo más alto del animal en cada punta:
  // adelante asoma la cabeza, ancha; atrás, a lo más la cola, delgada aunque
  // suba (gatos, husky). La cadera queda más abajo. Si la punta ancha quedó
  // atrás, se da vuelta.
  const caja = new THREE.Box3();
  for (const { geometria } of fuentes) {
    geometria.computeBoundingBox();
    caja.union(geometria.boundingBox!);
  }
  const largo = caja.max.x - caja.min.x;
  const corte = caja.min.y + (caja.max.y - caja.min.y) * ALTO_CABEZA;
  const adelante = { min: Infinity, max: -Infinity };
  const atras = { min: Infinity, max: -Infinity };
  for (const { geometria } of fuentes) {
    const pos = geometria.getAttribute("position");
    for (let i = 0; i < pos.count; i += 1) {
      if (pos.getY(i) < corte) continue;
      const x = pos.getX(i);
      const punta = x > caja.max.x - largo * PUNTA ? adelante : x < caja.min.x + largo * PUNTA ? atras : null;
      if (!punta) continue;
      punta.min = Math.min(punta.min, pos.getZ(i));
      punta.max = Math.max(punta.max, pos.getZ(i));
    }
  }
  const ancho = (punta: { min: number; max: number }) => (punta.max > punta.min ? punta.max - punta.min : 0);
  const vuelta = (ancho(atras) > ancho(adelante) ? Math.PI : 0) + (giroManual * Math.PI) / 180;
  if (vuelta !== 0) for (const { geometria } of fuentes) geometria.applyMatrix4(new THREE.Matrix4().makeRotationY(vuelta));

  // Se apoya en el piso y se escala al largo del cuerpo procedural de su raza.
  caja.makeEmpty();
  for (const { geometria } of fuentes) {
    geometria.computeBoundingBox();
    caja.union(geometria.boundingBox!);
  }
  const destino = cajaDe(partes);
  const escala = (destino.max.x - destino.min.x) / Math.max(1e-6, caja.max.x - caja.min.x);
  const centroX = (caja.min.x + caja.max.x) / 2;
  const centroZ = (caja.min.z + caja.max.z) / 2;
  const ajuste = new THREE.Matrix4()
    .makeTranslation((destino.min.x + destino.max.x) / 2, 0, 0)
    .multiply(new THREE.Matrix4().makeScale(escala, escala, escala))
    .multiply(new THREE.Matrix4().makeTranslation(-centroX, -caja.min.y, -centroZ));

  const formas = partes.filter((parte) => parte.forma !== "bigote");
  const mallas = fuentes.map(({ geometria, material }) => {
    geometria.applyMatrix4(ajuste);
    if (!geometria.getAttribute("normal")) geometria.computeVertexNormals();
    geometria.computeBoundingSphere();
    const pos = geometria.getAttribute("position");
    const regiones = new Int8Array(pos.count);
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      let menor = Infinity;
      let region = REGIONES.indexOf("piel");
      for (const forma of formas) {
        const d = distanciaA(forma, x, y, z);
        if (d < menor) {
          menor = d;
          region = REGIONES.indexOf(forma.region);
        }
      }
      regiones[i] = region;
    }
    return { geometria, material, regiones };
  });

  const cache = new Map<Region, THREE.BufferGeometry[]>();
  const zona = (region: Region) => {
    const guardada = cache.get(region);
    if (guardada) return guardada;
    const objetivo = REGIONES.indexOf(region);
    const resultado = mallas.map(({ geometria, regiones }) => {
      const indice = geometria.getIndex();
      const total = indice ? indice.count : geometria.getAttribute("position").count;
      const elegidos: number[] = [];
      for (let t = 0; t < total; t += 3) {
        const a = indice ? indice.getX(t) : t;
        const b = indice ? indice.getX(t + 1) : t + 1;
        const c = indice ? indice.getX(t + 2) : t + 2;
        if (regiones[a] === objetivo || regiones[b] === objetivo || regiones[c] === objetivo) elegidos.push(a, b, c);
      }
      const parcial = new THREE.BufferGeometry();
      parcial.setAttribute("position", geometria.getAttribute("position"));
      parcial.setAttribute("normal", geometria.getAttribute("normal"));
      parcial.setIndex(elegidos);
      return parcial;
    });
    cache.set(region, resultado);
    return resultado;
  };

  return {
    mallas,
    zona,
    dispose: () => {
      for (const { geometria } of mallas) geometria.dispose();
      for (const lista of cache.values()) for (const geometria of lista) geometria.dispose();
    },
  };
}

/** La zona de un punto tocado: la del vértice más cercano del triángulo. */
export function regionDeCara(regiones: Int8Array, cara: THREE.Face | null | undefined): Region | null {
  if (!cara) return null;
  const indice = regiones[cara.a];
  return indice >= 0 ? REGIONES[indice] : null;
}
