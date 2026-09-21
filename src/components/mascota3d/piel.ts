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
    const r1 = parte.radio;
    const r2 = parte.radio2 ?? parte.radio;
    const r = Math.max(r1, r2);
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const l2 = dx * dx + dy * dy + dz * dz || 1e-9;
    const rr = r1 - r2;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    return {
      region,
      color,
      minimo: new THREE.Vector3(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.min(az, bz) - r),
      maximo: new THREE.Vector3(Math.max(ax, bx) + r, Math.max(ay, by) + r, Math.max(az, bz) + r),
      // Cono redondeado (Quilez): una cápsula cuyo radio pasa de r1 a r2.
      distancia: (x, y, z) => {
        const pax = x - ax;
        const pay = y - ay;
        const paz = z - az;
        const yy = pax * dx + pay * dy + paz * dz;
        const zz = yy - l2;
        const qx = pax * l2 - dx * yy;
        const qy = pay * l2 - dy * yy;
        const qz = paz * l2 - dz * yy;
        const x2 = qx * qx + qy * qy + qz * qz;
        const y2 = yy * yy * l2;
        const z2 = zz * zz * l2;
        const k = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
        if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
        return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
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
  /**
   * Copia estática de la superficie actual (para dibujarla y ponerle pelo
   * encima), con un atributo `largo` por vértice: el pelo es más corto en la
   * cara, las orejas y las manos.
   */
  instantanea: () => THREE.BufferGeometry;
  regionEn: (punto: THREE.Vector3) => Region | null;
  /**
   * Lleva un ojo a la superficie real de la piel: lo empuja por el gradiente
   * del campo hasta que asome la mayor parte del globo.
   */
  asomar: (centro: [number, number, number], radio: number) => [number, number, number];
  pintar: (resaltada: Region | null) => void;
  dispose: () => void;
};

const paso = (desde: number, hasta: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - desde) / (hasta - desde)));
  return t * t * (3 - 2 * t);
};

export function crearPiel(partes: Parte[], manto: Manto | null = null, resolucion = 84): Piel {
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

  const regionMasCercana = (punto: THREE.Vector3): Region | null => {
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
  };
  let largos: Float32Array | null = null;

  const union = (x: number, y: number, z: number) => {
    let suma = 0;
    for (const forma of formas) suma += Math.exp(-forma.distancia(x, y, z) / suavidad);
    return suma === 0 ? 1 : -suavidad * Math.log(suma);
  };
  const asomar = (centro: [number, number, number], radio: number): [number, number, number] => {
    const p = new THREE.Vector3(...centro);
    const e = 0.002;
    const objetivo = -radio * 0.3;
    for (let i = 0; i < 8; i += 1) {
      const d = union(p.x, p.y, p.z);
      const gradiente = new THREE.Vector3(
        union(p.x + e, p.y, p.z) - union(p.x - e, p.y, p.z),
        union(p.x, p.y + e, p.z) - union(p.x, p.y - e, p.z),
        union(p.x, p.y, p.z + e) - union(p.x, p.y, p.z - e),
      ).normalize();
      if (!Number.isFinite(gradiente.x)) break;
      p.addScaledVector(gradiente, objetivo - d);
    }
    return [p.x, p.y, p.z];
  };

  return {
    malla,
    pintar,
    asomar,
    instantanea: () => {
      const vertices = malla.count;
      if (!largos || largos.length !== vertices) {
        // El campo no cambia al pintar: la superficie es la misma y el largo se calcula una vez.
        largos = new Float32Array(vertices);
        const punto = new THREE.Vector3();
        for (let i = 0; i < vertices; i += 1) {
          punto.fromArray(malla.positionArray, i * 3).multiplyScalar(s).add(centro);
          const region = regionMasCercana(punto);
          const corto = region === "ojos" || region === "boca" ? 0.1 : region === "cabeza" ? 0.35 : region === "oidos" ? 0.5 : 1;
          // Las manos y los pies, cerca del suelo, también llevan el pelo corto.
          largos[i] = corto * (0.45 + 0.55 * paso(0.02, 0.18, punto.y));
        }
      }
      const geometria = new THREE.BufferGeometry();
      geometria.setAttribute("largo", new THREE.BufferAttribute(largos, 1));
      geometria.setAttribute("position", new THREE.BufferAttribute(malla.positionArray.slice(0, vertices * 3), 3));
      geometria.setAttribute("normal", new THREE.BufferAttribute(malla.normalArray.slice(0, vertices * 3), 3));
      geometria.setAttribute("color", new THREE.BufferAttribute(malla.colorArray!.slice(0, vertices * 3), 3));
      geometria.computeBoundingSphere();
      return geometria;
    },
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
