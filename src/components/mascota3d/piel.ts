import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";

import { REGIONES, type Region } from "@/lib/anatomia";

import type { Manto, Parte } from "./cuerpo";

/**
 * Piel continua de la mascota.
 *
 * Las partes del cuerpo (tronco, cuello, cabeza, hocico, patas) se funden en
 * una sola superficie: se calcula la distancia a cada parte, se unen con un
 * mínimo suave y se extrae la superficie con marching cubes. Así no quedan
 * uniones entre bultos y los colores del pelaje se degradan de una zona a otra
 * (el manto del beagle, las puntas del siamés).
 *
 * Cada vóxel guarda además a qué zona clínica pertenece: con eso se sabe qué se
 * tocó y se ilumina la zona elegida.
 */

type Forma = {
  region: number;
  color: THREE.Color;
  minimo: THREE.Vector3;
  maximo: THREE.Vector3;
  distancia: (x: number, y: number, z: number) => number;
};

const MARGEN = 0.09;

function formaDe(parte: Parte): Forma | null {
  const region = REGIONES.indexOf(parte.region);
  const color = new THREE.Color(parte.color);
  if (parte.forma === "elipsoide") {
    if (parte.material && parte.material !== "pelo") return null;
    if (parte.rotacion && parte.rotacion.some((valor) => valor !== 0)) return null;
    const [cx, cy, cz] = parte.centro;
    const [rx, ry, rz] = parte.escala;
    return {
      region,
      color,
      minimo: new THREE.Vector3(cx - rx, cy - ry, cz - rz),
      maximo: new THREE.Vector3(cx + rx, cy + ry, cz + rz),
      // Distancia aproximada a un elipsoide (acotada, suficiente para unir).
      distancia: (x, y, z) => {
        const px = (x - cx) / rx;
        const py = (y - cy) / ry;
        const pz = (z - cz) / rz;
        const k0 = Math.hypot(px, py, pz);
        const k1 = Math.hypot(px / rx, py / ry, pz / rz);
        return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
      },
    };
  }
  if (parte.forma === "capsula") {
    const [ax, ay, az] = parte.desde;
    const [bx, by, bz] = parte.hasta;
    const r = parte.radio;
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const largo2 = dx * dx + dy * dy + dz * dz || 1e-9;
    return {
      region,
      color,
      minimo: new THREE.Vector3(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r),
      maximo: new THREE.Vector3(Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r),
      distancia: (x, y, z) => {
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / largo2));
        return Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t) - r;
      },
    };
  }
  return null;
}

/** Si una parte va en la piel continua o se dibuja aparte (ojos, nariz, orejas, cola). */
export function vaEnLaPiel(parte: Parte): boolean {
  return formaDe(parte) !== null;
}

export type Piel = {
  malla: MarchingCubes;
  regionEn: (punto: THREE.Vector3) => Region | null;
  pintar: (resaltada: Region | null) => void;
  dispose: () => void;
};

const paso = (desde: number, hasta: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - desde) / (hasta - desde)));
  return t * t * (3 - 2 * t);
};

export function crearPiel(partes: Parte[], manto: Manto | null = null, resolucion = 76): Piel {
  const colorManto = manto ? new THREE.Color(manto.color) : null;
  const formas = partes.map(formaDe).filter((forma): forma is Forma => forma !== null);

  const minimo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const maximo = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (const forma of formas) {
    minimo.min(forma.minimo);
    maximo.max(forma.maximo);
  }
  const centro = minimo.clone().add(maximo).multiplyScalar(0.5);
  const medio = maximo.clone().sub(minimo).multiplyScalar(0.5);
  const s = Math.max(medio.x, medio.y, medio.z) + MARGEN * 1.4;

  const material = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.86,
    sheen: 1,
    sheenColor: new THREE.Color("#b8b8b8"),
    sheenRoughness: 0.45,
  });
  const malla = new MarchingCubes(resolucion, material, false, true, 240000);
  malla.isolation = 80;
  malla.position.copy(centro);
  malla.scale.setScalar(s);
  malla.castShadow = true;
  malla.receiveShadow = true;

  const n = resolucion;
  const mitad = n / 2;
  const regiones = new Int8Array(n * n * n).fill(-1);
  const base = new Float32Array(n * n * n * 3);
  const suavidad = 0.028;
  const nitidez = 0.012;

  for (let iz = 0; iz < n; iz += 1) {
    const z = centro.z + ((iz - mitad) / mitad) * s;
    for (let iy = 0; iy < n; iy += 1) {
      const y = centro.y + ((iy - mitad) / mitad) * s;
      for (let ix = 0; ix < n; ix += 1) {
        const x = centro.x + ((ix - mitad) / mitad) * s;
        const q = ix + iy * n + iz * n * n;
        let suma = 0;
        let menor = Infinity;
        let region = -1;
        const cercanas: [number, Forma][] = [];
        for (const forma of formas) {
          if (
            x < forma.minimo.x - MARGEN || x > forma.maximo.x + MARGEN ||
            y < forma.minimo.y - MARGEN || y > forma.maximo.y + MARGEN ||
            z < forma.minimo.z - MARGEN || z > forma.maximo.z + MARGEN
          ) continue;
          const d = forma.distancia(x, y, z);
          suma += Math.exp(-d / suavidad);
          cercanas.push([d, forma]);
          if (d < menor) {
            menor = d;
            region = forma.region;
          }
        }
        if (cercanas.length === 0) {
          malla.field[q] = 0;
          continue;
        }
        const union = -suavidad * Math.log(suma);
        malla.field[q] = Math.max(0, 80 - union * 900);
        regiones[q] = region;

        // Color: mezcla de las partes más cercanas, con peso que cae rápido.
        let pesoTotal = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (const [d, forma] of cercanas) {
          const peso = Math.exp(-(d - menor) / nitidez);
          pesoTotal += peso;
          r += forma.color.r * peso;
          g += forma.color.g * peso;
          b += forma.color.b * peso;
        }
        r /= pesoTotal;
        g /= pesoTotal;
        b /= pesoTotal;
        if (manto && colorManto) {
          // El manto cubre el dorso y baja por los costados, con bordes suaves.
          const t = paso(manto.y0, manto.y1, y) * paso(manto.x0, manto.x0 + 0.2, x) * (1 - paso(manto.x1 - 0.2, manto.x1, x));
          r += (colorManto.r - r) * t;
          g += (colorManto.g - g) * t;
          b += (colorManto.b - b) * t;
        }
        base[q * 3] = r;
        base[q * 3 + 1] = g;
        base[q * 3 + 2] = b;
      }
    }
  }

  const resalte = new THREE.Color("#7dd3fc");
  const pintar = (resaltada: Region | null) => {
    const indice = resaltada ? REGIONES.indexOf(resaltada) : -2;
    for (let q = 0; q < regiones.length; q += 1) {
      const t = regiones[q] === indice ? 0.38 : 0;
      malla.palette[q * 3] = base[q * 3] + (resalte.r - base[q * 3]) * t;
      malla.palette[q * 3 + 1] = base[q * 3 + 1] + (resalte.g - base[q * 3 + 1]) * t;
      malla.palette[q * 3 + 2] = base[q * 3 + 2] + (resalte.b - base[q * 3 + 2]) * t;
    }
    malla.update();
  };
  pintar(null);

  return {
    malla,
    pintar,
    regionEn: (punto) => {
      let menor = Infinity;
      let region: number | null = null;
      for (const forma of formas) {
        const d = forma.distancia(punto.x, punto.y, punto.z);
        if (d < menor) {
          menor = d;
          region = forma.region;
        }
      }
      return region === null ? null : REGIONES[region];
    },
    dispose: () => {
      malla.geometry.dispose();
      material.dispose();
    },
  };
}
