import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { RAZAS } from "@/lib/anatomia";
import {
  BUCKET_MASCOTA_MODELOS,
  LISTA_MOTORES,
  type ModeloDeMascota,
  type Motor3D,
} from "@/lib/mascota-modelos";

/**
 * Generación de los modelos realistas por raza, con la clave de fal del
 * servidor: una foto de estudio de la raza (Nano Banana 2) y, sobre ella, el
 * modelo 3D de cada motor. El 3D tarda minutos, así que va a la cola de fal y
 * se consulta después; cuando está, se guarda en el bucket.
 */

/** Cómo se ve cada raza, para la foto de partida. */
const ASPECTO: Record<string, string> = {
  "Perro/Mestizo": "a medium-sized mixed-breed dog with a short brown coat, cream chest and paws",
  "Perro/Labrador": "an adult yellow Labrador Retriever with a short dense coat",
  "Perro/Golden Retriever": "an adult Golden Retriever with a medium-length golden coat and feathered tail",
  "Perro/Poodle": "an adult cream Standard Poodle with a natural curly coat (not show-clipped)",
  "Perro/Beagle": "an adult tricolor Beagle with a black saddle, tan head and white legs and chest",
  "Perro/Bulldog Francés": "an adult fawn French Bulldog with bat ears and a black mask",
  "Perro/Schnauzer": "an adult salt-and-pepper Miniature Schnauzer with beard and eyebrows",
  "Perro/Yorkshire": "an adult Yorkshire Terrier with a steel-blue body and tan head, medium-length coat",
  "Perro/Border Collie": "an adult black and white Border Collie",
  "Perro/Pastor Alemán": "an adult German Shepherd with a classic black saddle and tan coat",
  "Perro/Husky Siberiano": "an adult grey and white Siberian Husky with blue eyes",
  "Perro/Chihuahua": "an adult fawn short-haired Chihuahua",
  "Gato/Mestizo": "an adult brown tabby domestic shorthair cat with white chest",
  "Gato/Siamés": "an adult Siamese cat with a cream body, dark seal-point face mask, ears, paws and tail, and blue eyes",
  "Gato/Persa": "an adult white Persian cat with a long coat and copper eyes",
  "Gato/Maine Coon": "an adult brown tabby Maine Coon with a long coat, ear tufts and a bushy tail",
  "Gato/Bengalí": "an adult Bengal cat with a golden coat and dark rosette spots",
};

export function razaValida(especie: string, raza: string) {
  return RAZAS.some((item) => item.especie === especie && item.nombre === raza);
}

function promptDeFoto(especie: string, raza: string) {
  const aspecto = ASPECTO[`${especie}/${raza}`] ?? `an adult ${raza} ${especie === "Gato" ? "cat" : "dog"}`;
  return (
    `Photorealistic studio photograph of ${aspecto}. Full body, standing calmly on all four legs in a natural three-quarter view ` +
    `facing to the right of the frame, head looking forward, all four legs and paws clearly visible and separated, tail fully visible. ` +
    `Plain light grey seamless background, soft even studio lighting, no harsh shadows, no collar, no props, no people, no text. ` +
    `The entire animal fits in the frame with margin around it. Sharp focus, natural fur detail, true-to-breed proportions.`
  );
}

const MOTORES: Record<Motor3D, { modelo: string; entrada: (url: string) => Record<string, unknown> }> = {
  trellis: { modelo: "fal-ai/trellis", entrada: (url) => ({ image_url: url, texture_size: 2048 }) },
  tripo: { modelo: "tripo3d/tripo/v2.5/image-to-3d", entrada: (url) => ({ image_url: url, texture: "standard", pbr: true, face_limit: 120000 }) },
  hunyuan: {
    modelo: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
    entrada: (url) => ({ input_image_url: url, generate_type: "Normal", enable_pbr: true, face_count: 150000 }),
  },
};

function claveFal() {
  const clave = process.env.FAL_KEY?.trim();
  if (!clave) throw new Error("Falta configurar FAL_KEY en el servidor.");
  return clave;
}

const encabezados = () => ({ Authorization: `Key ${claveFal()}`, "Content-Type": "application/json" });

/** Busca la primera URL con esa extensión en la respuesta; prefiere la versión con materiales PBR. */
function buscarUrl(valor: unknown, extension: string): string | null {
  if (typeof valor === "string") return valor.split("?")[0].toLowerCase().endsWith(extension) ? valor : null;
  if (valor && typeof valor === "object") {
    const registro = valor as Record<string, unknown>;
    const claves = Object.keys(registro).sort((a, b) => Number(b.includes("pbr")) - Number(a.includes("pbr")));
    for (const clave of claves) {
      const url = buscarUrl(registro[clave], extension);
      if (url) return url;
    }
  }
  return null;
}

async function subir(admin: SupabaseClient, ruta: string, url: string, tipo: string) {
  const archivo = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!archivo.ok) throw new Error(`No se pudo descargar el archivo generado (${archivo.status}).`);
  const datos = Buffer.from(await archivo.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET_MASCOTA_MODELOS).upload(ruta, datos, { contentType: tipo, upsert: true });
  if (error) throw new Error(`No se pudo guardar el archivo: ${error.message}`);
}

const slug = (texto: string) =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * Pide la prueba de una raza: hace la foto (espera, son unos segundos), la
 * guarda y deja cada motor en la cola de fal.
 */
export async function pedirPrueba(admin: SupabaseClient, especie: "Perro" | "Gato", raza: string, motores: Motor3D[]) {
  const respuesta = await fetch("https://fal.run/fal-ai/nano-banana-2", {
    method: "POST",
    headers: encabezados(),
    body: JSON.stringify({ prompt: promptDeFoto(especie, raza), num_images: 1, aspect_ratio: "4:3", resolution: "1K", output_format: "png" }),
    signal: AbortSignal.timeout(80_000),
  });
  const json = (await respuesta.json().catch(() => null)) as { images?: { url?: string }[] } | null;
  const urlFoto = json?.images?.[0]?.url;
  if (!respuesta.ok || !urlFoto) throw new Error(`La foto de la raza falló (${respuesta.status}).`);

  const carpeta = `${slug(especie)}/${slug(raza)}/${Date.now()}`;
  const fotoPath = `${carpeta}/foto.png`;
  await subir(admin, fotoPath, urlFoto, "image/png");

  const filas = await Promise.all(
    motores.filter((motor) => LISTA_MOTORES.includes(motor)).map(async (motor) => {
      const { modelo, entrada } = MOTORES[motor];
      try {
        const envio = await fetch(`https://queue.fal.run/${modelo}`, { method: "POST", headers: encabezados(), body: JSON.stringify(entrada(urlFoto)) });
        const pedido = (await envio.json().catch(() => null)) as { request_id?: string; status_url?: string; response_url?: string } | null;
        if (!envio.ok || !pedido?.status_url || !pedido.response_url) throw new Error(`fal respondió ${envio.status}: ${JSON.stringify(pedido).slice(0, 240)}`);
        return { especie, raza, motor, estado: "generando", foto_path: fotoPath, solicitud: { ...pedido, carpeta } };
      } catch (error) {
        return { especie, raza, motor, estado: "fallido", foto_path: fotoPath, error: error instanceof Error ? error.message : "No se pudo pedir el modelo." };
      }
    }),
  );
  const { error } = await admin.from("mascota_modelos").insert(filas);
  if (error) throw new Error(`No se pudo registrar la prueba: ${error.message}`);
}

type FilaPendiente = { id: string; motor: Motor3D; solicitud: { status_url: string; response_url: string; carpeta: string }; created_at: string };

/**
 * Avanza lo que está en la cola: lo terminado se descarga y se guarda en el
 * bucket. Cada fila se toma con un cambio de estado condicionado, para que dos
 * consultas seguidas no la guarden dos veces.
 */
export async function avanzarPendientes(admin: SupabaseClient) {
  const atascadas = new Date(Date.now() - 4 * 60_000).toISOString();
  await admin.from("mascota_modelos").update({ estado: "generando" }).eq("estado", "guardando").lt("updated_at", atascadas);
  const { data } = await admin.from("mascota_modelos").select("id, motor, solicitud, created_at").eq("estado", "generando").limit(12);
  await Promise.all(
    ((data ?? []) as FilaPendiente[]).map(async (fila) => {
      try {
        const estado = (await (await fetch(fila.solicitud.status_url, { headers: encabezados() })).json().catch(() => null)) as { status?: string } | null;
        if (estado?.status !== "COMPLETED") {
          if (Date.now() - new Date(fila.created_at).getTime() > 20 * 60_000) {
            await admin.from("mascota_modelos").update({ estado: "fallido", error: "No terminó en 20 minutos.", updated_at: new Date().toISOString() }).eq("id", fila.id);
          }
          return;
        }
        const { data: tomada } = await admin
          .from("mascota_modelos")
          .update({ estado: "guardando", updated_at: new Date().toISOString() })
          .eq("id", fila.id)
          .eq("estado", "generando")
          .select("id")
          .maybeSingle();
        if (!tomada) return;
        const resultado = await fetch(fila.solicitud.response_url, { headers: encabezados() });
        const json = (await resultado.json().catch(() => null)) as unknown;
        const glb = resultado.ok ? buscarUrl(json, ".glb") : null;
        if (!glb) throw new Error(`El motor no devolvió un .glb (${resultado.status}): ${JSON.stringify(json).slice(0, 240)}`);
        const modeloPath = `${fila.solicitud.carpeta}/${fila.motor}.glb`;
        await subir(admin, modeloPath, glb, "model/gltf-binary");
        await admin
          .from("mascota_modelos")
          .update({
            estado: "listo",
            modelo_path: modeloPath,
            segundos: Math.round((Date.now() - new Date(fila.created_at).getTime()) / 1000),
            updated_at: new Date().toISOString(),
          })
          .eq("id", fila.id);
      } catch (error) {
        await admin
          .from("mascota_modelos")
          .update({ estado: "fallido", error: error instanceof Error ? error.message.slice(0, 500) : "Falló", updated_at: new Date().toISOString() })
          .eq("id", fila.id);
      }
    }),
  );
}

export function urlPublica(admin: SupabaseClient, ruta: string | null) {
  return ruta ? admin.storage.from(BUCKET_MASCOTA_MODELOS).getPublicUrl(ruta).data.publicUrl : null;
}

export async function listarModelos(admin: SupabaseClient): Promise<ModeloDeMascota[]> {
  const { data } = await admin
    .from("mascota_modelos")
    .select("id, especie, raza, motor, estado, foto_path, modelo_path, error, segundos, elegido, giro, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as (Omit<ModeloDeMascota, "foto_url" | "modelo_url"> & { foto_path: string | null; modelo_path: string | null })[]).map(
    ({ foto_path, modelo_path, ...fila }) => ({ ...fila, foto_url: urlPublica(admin, foto_path), modelo_url: urlPublica(admin, modelo_path) }),
  );
}
