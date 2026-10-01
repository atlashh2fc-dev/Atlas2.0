/**
 * Modelos 3D realistas por raza: qué motores hay, cuánto cuestan y la forma de
 * una fila. Puro (sin servidor): lo usan la consola, la ficha y la ruta.
 */

export const BUCKET_MASCOTA_MODELOS = "mascota-modelos";

/** Precio de la foto de estudio (Nano Banana 2, 1K), en US$. */
export const PRECIO_FOTO = 0.08;

export const MOTORES_3D = {
  trellis: { nombre: "Trellis", precio: 0.02 as number | null },
  tripo: { nombre: "Tripo 2.5", precio: 0.3 as number | null },
  hunyuan: { nombre: "Hunyuan 3D Pro", precio: null as number | null },
} as const;
export type Motor3D = keyof typeof MOTORES_3D;
export const LISTA_MOTORES = Object.keys(MOTORES_3D) as Motor3D[];

export type ModeloDeMascota = {
  id: string;
  especie: "Perro" | "Gato";
  raza: string;
  motor: Motor3D;
  estado: "generando" | "guardando" | "listo" | "fallido";
  foto_url: string | null;
  modelo_url: string | null;
  error: string | null;
  segundos: number | null;
  elegido: boolean;
  giro: 0 | 90 | 180 | 270;
  created_at: string;
};

/** El modelo elegido de una raza, tal como lo necesita el visor. */
export type ModeloElegido = { url: string; giro: number };

export const claveDeRaza = (especie: string, raza: string) => `${especie}/${raza}`;

/** Lo que cuesta una prueba de una raza con los motores pedidos (sin los de precio desconocido). */
export function costoDePrueba(motores: Motor3D[]): { total: number; incompleto: boolean } {
  let total = PRECIO_FOTO;
  let incompleto = false;
  for (const motor of motores) {
    const precio = MOTORES_3D[motor].precio;
    if (precio === null) incompleto = true;
    else total += precio;
  }
  return { total, incompleto };
}

/**
 * Desde Configuración la clínica no compara motores: pide el modelo de una raza
 * y queda puesto solo. Va con un único motor para que el gasto por raza sea
 * conocido; comparar y cambiar de motor sigue en la consola de plataforma.
 */
export const MOTOR_DE_CLINICA: Motor3D = "tripo";

/** Lo que cuesta pedir una raza desde Configuración: la foto y ese motor. */
export const COSTO_POR_RAZA = costoDePrueba([MOTOR_DE_CLINICA]).total;

/** Una raza de las mascotas de la clínica y en qué está su modelo. */
export type RazaDeClinica = {
  especie: "Perro" | "Gato";
  raza: string;
  /** Cuántas mascotas de la clínica son de esta raza. */
  mascotas: number;
  estado: "realista" | "generando" | "fallida" | "dibujada";
  foto_url: string | null;
  error: string | null;
};
