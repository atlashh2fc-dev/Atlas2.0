import type { FaceLandmarker } from "@mediapipe/tasks-vision";

import { OJOS, PUNTOS_ESTABLES, alinear, type Punto } from "@/lib/alinear-rostro";

/*
 * Alinea en el navegador el "antes" y la simulación antes de compararlos:
 * detecta la cara en ambas con MediaPipe, lleva la simulación sobre el antes
 * y recorta las dos al mismo cuadro. Si no se puede alinear, devuelve null y
 * el comparador no parte la imagen.
 */

const VERSION = "1.0.1";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODELO = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let detector: Promise<FaceLandmarker> | null = null;

/** Carga el detector (una vez). Se llama apenas se abre el paso de propuestas para que esté listo al comparar. */
export function prepararDetector(): Promise<FaceLandmarker> {
  detector ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const archivos = await FilesetResolver.forVisionTasks(WASM);
    // CPU: una cara por imagen tarda decenas de milisegundos; la GPU demora segundos en arrancar la primera vez.
    return FaceLandmarker.createFromOptions(archivos, { baseOptions: { modelAssetPath: MODELO, delegate: "CPU" }, runningMode: "IMAGE", numFaces: 1 });
  })().catch((error) => {
    detector = null;
    throw error;
  });
  return detector;
}

function cargar(url: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const imagen = new Image();
    imagen.crossOrigin = "anonymous";
    imagen.onload = () => resolver(imagen);
    imagen.onerror = () => rechazar(new Error("imagen"));
    imagen.src = url;
  });
}

function puntosDe(caras: FaceLandmarker, imagen: HTMLImageElement): Punto[] | null {
  const marcas = caras.detect(imagen).faceLandmarks[0];
  if (!marcas) return null;
  return PUNTOS_ESTABLES.map((indice) => ({ x: marcas[indice].x * imagen.naturalWidth, y: marcas[indice].y * imagen.naturalHeight }));
}

/** Color medio de las esquinas: el fondo de estudio, para rellenar si hiciera falta. */
function colorDeFondo(imagen: HTMLImageElement): string {
  const lienzo = document.createElement("canvas");
  lienzo.width = lienzo.height = 8;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "#8a847d";
  ctx.drawImage(imagen, 0, 0, 8, 8);
  const esquinas = [ctx.getImageData(0, 0, 1, 1), ctx.getImageData(7, 0, 1, 1)].map((pixel) => pixel.data);
  const canal = (i: number) => Math.round((esquinas[0][i] + esquinas[1][i]) / 2);
  return `rgb(${canal(0)}, ${canal(1)}, ${canal(2)})`;
}

function aUrl(lienzo: HTMLCanvasElement): Promise<string> {
  return new Promise((resolver, rechazar) => lienzo.toBlob((blob) => (blob ? resolver(URL.createObjectURL(blob)) : rechazar(new Error("lienzo"))), "image/jpeg", 0.92));
}

async function calcular(antesUrl: string, despuesUrl: string): Promise<{ antes: string; despues: string } | null> {
  const [caras, antes, despues] = await Promise.all([prepararDetector(), cargar(antesUrl), cargar(despuesUrl)]);
  const puntosAntes = puntosDe(caras, antes);
  const puntosDespues = puntosDe(caras, despues);
  if (!puntosAntes || !puntosDespues) return null;
  const [ojoDerecho, ojoIzquierdo] = OJOS.map((indice) => puntosAntes[PUNTOS_ESTABLES.indexOf(indice)]);
  const alineacion = alinear(
    puntosDespues,
    puntosAntes,
    { ancho: despues.naturalWidth, alto: despues.naturalHeight },
    { ancho: antes.naturalWidth, alto: antes.naturalHeight },
    Math.hypot(ojoIzquierdo.x - ojoDerecho.x, ojoIzquierdo.y - ojoDerecho.y),
  );
  if (!alineacion) return null;
  const { transformacion: t, recorte } = alineacion;

  const lienzo = document.createElement("canvas");
  lienzo.width = recorte.ancho;
  lienzo.height = recorte.alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(antes, recorte.x, recorte.y, recorte.ancho, recorte.alto, 0, 0, recorte.ancho, recorte.alto);
  const urlAntes = await aUrl(lienzo);

  ctx.fillStyle = colorDeFondo(despues);
  ctx.fillRect(0, 0, recorte.ancho, recorte.alto);
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(t.a, t.b, -t.b, t.a, t.tx - recorte.x, t.ty - recorte.y);
  ctx.drawImage(despues, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { antes: urlAntes, despues: await aUrl(lienzo) };
}

const hechas = new Map<string, Promise<{ antes: string; despues: string } | null>>();

/** El par alineado, recordado por pareja de enlaces. Nunca rechaza: si algo falla, null. */
export function alinearConAntes(antes: string, despues: string): Promise<{ antes: string; despues: string } | null> {
  const clave = `${antes}\n${despues}`;
  let par = hechas.get(clave);
  if (!par) {
    par = calcular(antes, despues).catch(() => {
      hechas.delete(clave);
      return null;
    });
    hechas.set(clave, par);
    if (hechas.size > 40) {
      const [vieja] = hechas.keys();
      void hechas.get(vieja)?.then((listo) => listo && [listo.antes, listo.despues].forEach((url) => URL.revokeObjectURL(url)));
      hechas.delete(vieja);
    }
  }
  return par;
}
