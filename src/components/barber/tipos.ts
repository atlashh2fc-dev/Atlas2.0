import type { AnalisisLook, EstadoLook, MapaCorte, PropuestaLook } from "@/lib/look";

/** Un look como lo recibe la ficha: con las fotos ya firmadas. */
export type LookFicha = {
  id: string;
  estado: EstadoLook;
  created_at: string;
  pedido: string | null;
  barbero: string | null;
  foto: string | null;
  fotoPerfil: string | null;
  fotoDespues: string | null;
  fotosBorradas: boolean;
  analisis: AnalisisLook | null;
  propuestaAprobada: string | null;
  compartido: boolean;
  /** El cliente tal como llegó, en 3D. */
  modelo: { estado: "generando" | "listo" | "fallido"; url: string | null } | null;
  propuestas: PropuestaLook[];
};

export type MapaGuardado = {
  id: string;
  look_id: string | null;
  nombre: string | null;
  mapa: MapaCorte;
  nota: string | null;
  profesional: string | null;
  fecha: string;
  created_at: string;
};

export type IaDisponible = { analisis: boolean; simulacion: boolean; modelo3d: boolean };

/** Achica la foto en el navegador antes de subirla: más rápido y más barato de analizar. */
export async function reducirFoto(origen: Blob | HTMLCanvasElement, lado = 1280): Promise<Blob> {
  const lienzo = document.createElement("canvas");
  let ancho: number;
  let alto: number;
  let fuente: CanvasImageSource;
  if (origen instanceof HTMLCanvasElement) {
    ancho = origen.width;
    alto = origen.height;
    fuente = origen;
  } else {
    const imagen = await createImageBitmap(origen);
    ancho = imagen.width;
    alto = imagen.height;
    fuente = imagen;
  }
  const escala = Math.min(1, lado / Math.max(ancho, alto));
  lienzo.width = Math.round(ancho * escala);
  lienzo.height = Math.round(alto * escala);
  const contexto = lienzo.getContext("2d");
  if (!contexto) throw new Error("El navegador no pudo procesar la foto.");
  contexto.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
  return await new Promise<Blob>((resolver, rechazar) =>
    lienzo.toBlob((blob) => (blob ? resolver(blob) : rechazar(new Error("No se pudo preparar la foto."))), "image/jpeg", 0.9),
  );
}
