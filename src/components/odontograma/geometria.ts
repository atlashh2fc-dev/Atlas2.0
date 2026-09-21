import * as THREE from "three";
import { ParametricGeometry } from "three/examples/jsm/geometries/ParametricGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { Pieza, TipoDiente } from "@/lib/odontograma";

/**
 * Anatomía procedural de la boca, en milímetros.
 *
 * Cada pieza es una superficie paramétrica: una sección de superelipse que
 * sube desde el ápice de la raíz, se estrecha en el cuello (límite amelo-
 * cementario), se ensancha hasta el contorno máximo de la corona y cierra en la
 * cara oclusal con las cúspides de su tipo: borde incisal en los incisivos,
 * punta en el canino, dos cúspides en el premolar y cuatro con fosa central en
 * el molar. El origen de cada pieza está en su cuello (y = 0), con la corona
 * hacia +y; las superiores se reflejan.
 */

export type Medidas = {
  /** Mitad del ancho mesiodistal máximo de la corona. */
  a: number;
  /** Mitad del ancho vestíbulo-lingual máximo. */
  b: number;
  corona: number;
  raiz: number;
};

// Medidas medias de la literatura (Wheeler), en mm: [ancho MD, ancho VL, corona, raíz].
const PERMANENTES: Record<"sup" | "inf", [number, number, number, number][]> = {
  sup: [
    [8.6, 7.0, 10.5, 13], [6.6, 6.0, 9.0, 13], [7.6, 8.0, 10.0, 17], [7.0, 9.0, 8.5, 14],
    [6.8, 9.0, 8.0, 14], [10.2, 11.0, 7.5, 12.5], [9.2, 11.0, 7.0, 11.5], [8.6, 10.0, 6.5, 11],
  ],
  inf: [
    [5.2, 6.0, 9.0, 12.5], [5.8, 6.4, 9.5, 14], [7.0, 7.5, 11.0, 16], [7.0, 7.6, 8.5, 14],
    [7.1, 8.0, 8.0, 14.5], [11.2, 10.5, 7.5, 14], [10.6, 10.0, 7.0, 13], [10.0, 9.5, 7.0, 11],
  ],
};
const TEMPORALES: Record<"sup" | "inf", [number, number, number, number][]> = {
  sup: [[6.5, 5.0, 6.0, 10], [5.2, 4.2, 5.6, 10], [7.0, 7.0, 6.5, 13], [7.3, 8.5, 5.1, 10], [8.2, 10.0, 5.7, 10]],
  inf: [[4.2, 4.0, 5.0, 9], [4.4, 4.2, 5.2, 10], [5.0, 4.8, 5.8, 11], [7.7, 7.0, 6.0, 9], [9.9, 8.7, 5.5, 10]],
};

export function medidasDe(pieza: Pieza): Medidas {
  const tabla = (pieza.temporal ? TEMPORALES : PERMANENTES)[pieza.superior ? "sup" : "inf"];
  const [md, vl, corona, raiz] = tabla[pieza.posicion - 1];
  return { a: md / 2, b: vl / 2, corona, raiz };
}

const suave = (desde: number, hasta: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - desde) / (hasta - desde)));
  return t * t * (3 - 2 * t);
};
const potencia = (base: number, exponente: number) => Math.sign(base) * Math.abs(base) ** exponente;

/** Relieve oclusal por tipo, en coordenadas normalizadas de la corona (-1..1). */
function cuspides(tipo: TipoDiente, x: number, z: number): number {
  const lomo = (cx: number, cz: number, ancho: number) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / ancho);
  switch (tipo) {
    case "molar":
      return (
        lomo(0.42, 0.42, 0.14) + lomo(-0.42, 0.42, 0.14) + lomo(0.42, -0.42, 0.14) + lomo(-0.42, -0.42, 0.14)
        - 0.55 * lomo(0, 0, 0.08) - 0.25 * lomo(0, 0.35, 0.02) - 0.25 * lomo(0, -0.35, 0.02)
      );
    case "premolar":
      return lomo(0, 0.42, 0.16) * 1.1 + lomo(0, -0.45, 0.16) * 0.85 - 0.45 * lomo(0, 0, 0.05);
    case "canino":
      return lomo(0, 0.1, 0.18) * 1.6;
    default:
      // Borde incisal con los tres mamelones apenas marcados.
      return 0.12 * (lomo(-0.5, 0, 0.05) + lomo(0, 0, 0.05) + lomo(0.5, 0, 0.05));
  }
}

export type FormaDiente = {
  geometria: THREE.BufferGeometry;
  /** Solo la corona, para cuando la raíz no es natural (implante). */
  soloCorona: THREE.BufferGeometry;
  /** Evalúa un punto de la superficie: u es la vuelta (0..1), v la altura (0 ápice, 1 centro oclusal). */
  punto: (u: number, v: number) => THREE.Vector3;
  medidas: Medidas;
};

const cache = new Map<string, FormaDiente>();

export function formaDe(pieza: Pieza): FormaDiente {
  const clave = `${pieza.temporal ? "t" : "p"}-${pieza.superior ? "s" : "i"}-${pieza.posicion}`;
  const guardada = cache.get(clave);
  if (guardada) return guardada;

  const medidas = medidasDe(pieza);
  const { a, b, corona, raiz } = medidas;
  const tipo = pieza.tipo;
  const anterior = tipo === "incisivo_central" || tipo === "incisivo_lateral";
  const exponente = tipo === "molar" ? 0.62 : tipo === "premolar" ? 0.72 : 0.8;
  const cuelloA = a * (tipo === "molar" ? 0.78 : 0.7);
  const cuelloB = b * 0.82;
  const vRaiz = raiz / (raiz + corona);
  const hombro = anterior ? 0.7 : 0.6;
  const relieve = tipo === "molar" ? 1.1 : tipo === "premolar" ? 1.3 : tipo === "canino" ? 1.6 : 0.5;

  const punto = (u: number, v: number, destino = new THREE.Vector3()) => {
    const angulo = u * Math.PI * 2;
    const cx = potencia(Math.cos(angulo), exponente);
    const cz = potencia(Math.sin(angulo), exponente);
    let rx: number;
    let rz: number;
    let y: number;

    if (v < vRaiz) {
      // Raíz: del ápice redondeado al cuello, con dos raíces insinuadas en molares.
      const s = v / vRaiz;
      const cierre = Math.sin(Math.min(1, s * 3.2) * Math.PI / 2) ** 0.7;
      const ahusado = 0.32 + 0.68 * s ** 0.85;
      rx = cuelloA * cierre * ahusado;
      rz = cuelloB * cierre * ahusado;
      if (tipo === "molar") rz *= 1 - 0.18 * Math.cos(angulo * 2) ** 2 * (1 - s);
      y = -raiz * (1 - s);
    } else {
      const t = (v - vRaiz) / (1 - vRaiz);
      if (t < hombro) {
        // Pared de la corona: del cuello estrecho al contorno máximo.
        const p = t / hombro;
        const ensanche = Math.sin(Math.min(1, p * 1.35) * Math.PI / 2);
        rx = cuelloA + (a - cuelloA) * ensanche;
        rz = cuelloB + (b - cuelloB) * ensanche;
        if (anterior) rz *= 1 - 0.55 * suave(0.35, 1, p);
        y = corona * 0.8 * p;
      } else {
        // Cara oclusal o borde incisal que cierra la corona.
        const q = (t - hombro) / (1 - hombro);
        const cierre = Math.cos(q * Math.PI / 2);
        // En los anteriores el borde incisal se angosta y redondea sus ángulos.
        rx = a * (anterior ? 1 - 0.3 * q ** 1.6 - 0.12 * Math.abs(Math.cos(angulo)) ** 6 * q : cierre ** 0.85);
        rz = b * (anterior ? 0.45 * cierre : cierre ** 0.85);
        y = corona * (0.8 + 0.2 * (1 - (1 - q) ** 2.4));
      }
    }

    const x = rx * cx;
    const z = rz * cz;
    if (v > vRaiz) {
      const t = (v - vRaiz) / (1 - vRaiz);
      y += cuspides(tipo, x / a, z / b) * corona * 0.09 * relieve * suave(hombro - 0.1, 1, t);
    }
    return destino.set(x, y, z);
  };

  // Se unen los vértices de la costura y de los polos para que el esmalte no
  // muestre una línea donde la superficie da la vuelta.
  const parametrica = new ParametricGeometry((u, v, destino) => punto(u, v, destino), 72, 56);
  parametrica.deleteAttribute("uv");
  parametrica.deleteAttribute("normal");
  const geometria = mergeVertices(parametrica, 1e-4);
  parametrica.dispose();
  geometria.computeVertexNormals();

  // Color natural: raíz amarillenta, corona marfil y un borde incisal apenas azulado.
  const posiciones = geometria.getAttribute("position");
  const colores = new Float32Array(posiciones.count * 3);
  const raizColor = new THREE.Color("#d8c8a2");
  const cuello = new THREE.Color("#eadfc6");
  const cuerpo = new THREE.Color(pieza.temporal ? "#f7f6f2" : "#f1ebdf");
  const borde = new THREE.Color("#e2e8ee");
  const color = new THREE.Color();
  for (let i = 0; i < posiciones.count; i += 1) {
    const y = posiciones.getY(i);
    if (y < 0) color.copy(raizColor).lerp(cuello, suave(-raiz * 0.3, 0, y));
    else color.copy(cuello).lerp(cuerpo, suave(0, corona * 0.45, y));
    if (anterior && y > corona * 0.8) color.lerp(borde, suave(corona * 0.8, corona, y) * 0.7);
    colores.set([color.r, color.g, color.b], i * 3);
  }
  geometria.setAttribute("color", new THREE.BufferAttribute(colores, 3));

  const coronaParametrica = new ParametricGeometry((u, v, destino) => punto(u, vRaiz + (1 - vRaiz) * v, destino), 72, 36);
  coronaParametrica.deleteAttribute("uv");
  coronaParametrica.deleteAttribute("normal");
  const soloCorona = mergeVertices(coronaParametrica, 1e-4);
  coronaParametrica.dispose();
  soloCorona.computeVertexNormals();
  const tonos = new Float32Array(soloCorona.getAttribute("position").count * 3);
  for (let i = 0; i < tonos.length / 3; i += 1) {
    color.copy(cuello).lerp(cuerpo, suave(0, corona * 0.45, soloCorona.getAttribute("position").getY(i)));
    tonos.set([color.r, color.g, color.b], i * 3);
  }
  soloCorona.setAttribute("color", new THREE.BufferAttribute(tonos, 3));

  const forma = { geometria, soloCorona, punto: (u: number, v: number) => punto(u, v), medidas };
  cache.set(clave, forma);
  return forma;
}

// Arcadas ---------------------------------------------------------------------

/** Media arcada derecha (x ≥ 0), de la línea media hacia atrás. Forma en U, en mm. */
const ARCADA_SUPERIOR = [
  [0, 27], [8.5, 24.6], [15.4, 19.6], [20.4, 12.4], [23.8, 4.4], [26.3, -4.8], [28.1, -14.8], [29.2, -24.6], [29.8, -33],
];
const ARCADA_INFERIOR = [
  [0, 23.5], [6.2, 22.2], [12.2, 18.6], [17.2, 12.6], [20.6, 5.6], [23.3, -3.2], [25.2, -13.4], [26.5, -23.8], [27.2, -32],
];

export type Ubicacion = {
  posicion: THREE.Vector3;
  /** Rotación en y que lleva la cara vestibular (+z local) hacia afuera. */
  giro: number;
  /** +1 si la cara mesial es +x local; -1 si es -x. */
  mesial: 1 | -1;
};

function curvaDe(superior: boolean, temporal: boolean): THREE.CatmullRomCurve3 {
  const escala = temporal ? 0.74 : 1;
  const puntos = (superior ? ARCADA_SUPERIOR : ARCADA_INFERIOR).map(([x, z]) => new THREE.Vector3(x * escala, 0, z * escala));
  return new THREE.CatmullRomCurve3(puntos, false, "centripetal");
}

/** Dónde va cada pieza: sobre la curva, por largo de arco, según los anchos reales. */
export function ubicarPiezas(piezas: Pieza[], plano: { superior: number; inferior: number }): Map<number, Ubicacion> {
  const ubicaciones = new Map<number, Ubicacion>();
  for (const superior of [true, false]) {
    for (const temporal of [false, true]) {
      const delLado = piezas.filter((pieza) => pieza.superior === superior && pieza.temporal === temporal && (pieza.cuadrante === 1 || pieza.cuadrante === 4));
      if (delLado.length === 0) continue;
      const curva = curvaDe(superior, temporal);
      const largo = curva.getLength();
      let recorrido = 0;
      for (const pieza of delLado.sort((x, y) => x.posicion - y.posicion)) {
        const ancho = medidasDe(pieza).a * 2;
        const centro = recorrido + ancho / 2;
        recorrido += ancho + 0.15;
        const u = Math.min(0.999, centro / largo);
        const punto = curva.getPointAt(u);
        const tangente = curva.getTangentAt(u);
        // La media curva va por x ≥ 0, que de frente es la izquierda del
        // paciente (cuadrantes 2 y 3). La derecha (1 y 4) es su reflejo.
        const afuera = new THREE.Vector3(-tangente.z, 0, tangente.x).normalize();
        for (const lado of [1, -1] as const) {
          const numero = lado === -1 ? pieza.numero : pieza.numero + (pieza.superior ? 10 : -10);
          const normal = new THREE.Vector3(afuera.x * lado, 0, afuera.z);
          ubicaciones.set(numero, {
            posicion: new THREE.Vector3(punto.x * lado, superior ? plano.superior : plano.inferior, punto.z),
            giro: Math.atan2(normal.x, normal.z),
            // +x local apunta hacia afuera de la línea media en el lado x ≥ 0.
            mesial: lado === -1 ? 1 : -1,
          });
        }
      }
    }
  }
  return ubicaciones;
}

/**
 * Encía de una arcada: una banda que sigue la curva, con el margen festoneado
 * (sube en las papilas entre pieza y pieza y baja en el centro de cada una).
 */
export function crearEncia(piezas: Pieza[], ubicaciones: Map<number, Ubicacion>, superior: boolean, alto = 17): THREE.BufferGeometry {
  const ordenadas = piezas
    .filter((pieza) => pieza.superior === superior)
    .map((pieza) => ({ pieza, ubicacion: ubicaciones.get(pieza.numero)!, medidas: medidasDe(pieza) }))
    .filter((item) => item.ubicacion)
    .sort((x, y) => x.ubicacion.posicion.x - y.ubicacion.posicion.x);

  // Recorrido de izquierda a derecha por los centros, con extremos detrás del último molar.
  const centros = ordenadas.map((item) => item.ubicacion.posicion.clone().setY(0));
  const primero = ordenadas[0];
  const ultimo = ordenadas[ordenadas.length - 1];
  // Detrás del último molar la encía sigue un poco (el trígono o la tuberosidad).
  const extremo = (item: typeof primero) => item.ubicacion.posicion.clone().setY(0).add(new THREE.Vector3(0, 0, -item.medidas.a * 1.1));
  const curva = new THREE.CatmullRomCurve3([extremo(primero), ...centros, extremo(ultimo)], false, "centripetal");

  const segmentos = 260;
  const perfil = 22;
  const vertices: number[] = [];
  const indices: number[] = [];
  const arriba = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i <= segmentos; i += 1) {
    const u = i / segmentos;
    const punto = curva.getPointAt(u);
    const tangente = curva.getTangentAt(u);
    const afuera = new THREE.Vector3().crossVectors(tangente, arriba).normalize();
    if (afuera.dot(new THREE.Vector3(punto.x, 0, punto.z - (superior ? -4 : -3))) < 0) afuera.negate();

    // Pieza más cercana: da el grosor de la encía y la fase del festón.
    let cercana = ordenadas[0];
    let distancia = Infinity;
    for (const item of ordenadas) {
      const d = item.ubicacion.posicion.clone().setY(0).distanceTo(punto);
      if (d < distancia) {
        distancia = d;
        cercana = item;
      }
    }
    const grosor = cercana.medidas.b * 0.72 + 1.1;
    const fase = Math.min(1, distancia / (cercana.medidas.a + 0.1));
    const papila = 2.2 * fase ** 1.6 * (cercana.pieza.tipo === "molar" ? 0.8 : 1.1);

    for (let j = 0; j <= perfil; j += 1) {
      // Sección de reborde alveolar: paredes casi verticales (la vestibular
      // algo abombada por las raíces), fondo redondeado y el margen arriba.
      const w = j / perfil;
      const phi = Math.PI + Math.PI * w;
      const cx = potencia(Math.cos(phi), 0.32);
      const sy = potencia(Math.sin(phi), 0.5);
      const lateral = cx * grosor * (1 + (cx > 0 ? 0.12 : 0.03) * Math.sin(-sy * Math.PI));
      const borde = (1 + sy) ** 10;
      const margen = -0.5 + papila * borde + 0.7 * borde;
      const y = margen * borde + sy * alto;
      const v = punto.clone().addScaledVector(afuera, lateral);
      vertices.push(v.x, superior ? -y : y, v.z);
    }
  }
  for (let i = 0; i < segmentos; i += 1) {
    for (let j = 0; j < perfil; j += 1) {
      const a = i * (perfil + 1) + j;
      const b = a + perfil + 1;
      if (superior) indices.push(a, a + 1, b, b, a + 1, b + 1);
      else indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometria.setIndex(indices);
  geometria.computeVertexNormals();
  return geometria;
}
