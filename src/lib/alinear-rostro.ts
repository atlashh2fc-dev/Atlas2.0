/**
 * Alinear el "antes" y la simulación: el editor de fotos no respeta siempre
 * el encuadre, así que la cara puede salir más grande, más baja o corrida.
 * Con los puntos de la cara de cada imagen se calcula la similitud (escala,
 * giro y traslado) que lleva la simulación sobre el antes, y el rectángulo
 * que ambas cubren. Puro: sin navegador, para poder probarlo.
 */

export type Punto = { x: number; y: number };

/** x' = a·x − b·y + tx ; y' = b·x + a·y + ty */
export type Similitud = { a: number; b: number; tx: number; ty: number };

export type Recorte = { x: number; y: number; ancho: number; alto: number };

/**
 * Índices de la malla de rostro de MediaPipe que no cambian con un corte de
 * pelo ni con la barba: comisuras de los ojos, puente y punta de la nariz,
 * y comisuras de la boca.
 */
export const PUNTOS_ESTABLES = [33, 133, 362, 263, 168, 6, 1, 61, 291] as const;
/** Comisura externa de cada ojo, para medir la distancia entre ojos. */
export const OJOS = [33, 263] as const;

export function aplicar(t: Similitud, p: Punto): Punto {
  return { x: t.a * p.x - t.b * p.y + t.tx, y: t.b * p.x + t.a * p.y + t.ty };
}

export function escalaDe(t: Similitud): number {
  return Math.hypot(t.a, t.b);
}

/** Mínimos cuadrados de la similitud que lleva `origen` sobre `destino`. */
export function ajustarSimilitud(origen: Punto[], destino: Punto[]): Similitud | null {
  const n = Math.min(origen.length, destino.length);
  if (n < 2) return null;
  const media = (puntos: Punto[]) => ({ x: puntos.slice(0, n).reduce((s, p) => s + p.x, 0) / n, y: puntos.slice(0, n).reduce((s, p) => s + p.y, 0) / n });
  const mo = media(origen);
  const md = media(destino);
  let sxx = 0;
  let sxy = 0;
  let norma = 0;
  for (let i = 0; i < n; i++) {
    const ox = origen[i].x - mo.x;
    const oy = origen[i].y - mo.y;
    const dx = destino[i].x - md.x;
    const dy = destino[i].y - md.y;
    sxx += ox * dx + oy * dy;
    sxy += ox * dy - oy * dx;
    norma += ox * ox + oy * oy;
  }
  if (norma === 0) return null;
  const a = sxx / norma;
  const b = sxy / norma;
  return { a, b, tx: md.x - (a * mo.x - b * mo.y), ty: md.y - (b * mo.x + a * mo.y) };
}

/** Error medio del ajuste, en proporción a la distancia entre los ojos del destino. */
export function errorRelativo(t: Similitud, origen: Punto[], destino: Punto[], distanciaOjos: number): number {
  if (distanciaOjos <= 0) return Infinity;
  const n = Math.min(origen.length, destino.length);
  let suma = 0;
  for (let i = 0; i < n; i++) {
    const p = aplicar(t, origen[i]);
    suma += Math.hypot(p.x - destino[i].x, p.y - destino[i].y);
  }
  return suma / n / distanciaOjos;
}

/**
 * El rectángulo del antes que también cubre la simulación ya alineada: así
 * ninguna de las dos muestra bordes vacíos.
 */
export function recorteComun(t: Similitud, despues: { ancho: number; alto: number }, antes: { ancho: number; alto: number }): Recorte {
  const [si, sd, id, ii] = [
    aplicar(t, { x: 0, y: 0 }),
    aplicar(t, { x: despues.ancho, y: 0 }),
    aplicar(t, { x: despues.ancho, y: despues.alto }),
    aplicar(t, { x: 0, y: despues.alto }),
  ];
  const x0 = Math.max(0, si.x, ii.x);
  const x1 = Math.min(antes.ancho, sd.x, id.x);
  const y0 = Math.max(0, si.y, sd.y);
  const y1 = Math.min(antes.alto, ii.y, id.y);
  return { x: Math.ceil(x0), y: Math.ceil(y0), ancho: Math.max(0, Math.floor(x1 - x0)), alto: Math.max(0, Math.floor(y1 - y0)) };
}

export type Alineacion = { transformacion: Similitud; recorte: Recorte };

/**
 * Decide la alineación o dice que no se puede. Solo se acepta si el ajuste es
 * bueno: un antes y después descuadrado no se muestra nunca.
 */
export function alinear(
  puntosDespues: Punto[],
  puntosAntes: Punto[],
  despues: { ancho: number; alto: number },
  antes: { ancho: number; alto: number },
  distanciaOjosAntes: number,
): Alineacion | null {
  const transformacion = ajustarSimilitud(puntosDespues, puntosAntes);
  if (!transformacion) return null;
  const escala = escalaDe(transformacion);
  if (escala < 0.4 || escala > 2.5) return null;
  if (Math.abs(Math.atan2(transformacion.b, transformacion.a)) > 0.35) return null;
  if (errorRelativo(transformacion, puntosDespues, puntosAntes, distanciaOjosAntes) > 0.08) return null;
  const comun = recorteComun(transformacion, despues, antes);
  // Si recortar se comería demasiado, se deja el cuadro entero y el borde se rellena con el fondo.
  const recorte = comun.ancho >= antes.ancho * 0.6 && comun.alto >= antes.alto * 0.6 ? comun : { x: 0, y: 0, ancho: antes.ancho, alto: antes.alto };
  return { transformacion, recorte };
}
