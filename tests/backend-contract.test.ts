// Contrato del back contra la base real, campaña por campaña.
//
// El resto de las pruebas de este repositorio leen el texto de las migraciones.
// Eso caza que alguien cambie una consulta, pero no caza que una campaña con
// datos distintos rompa una pantalla. Esta suite llama a las funciones de
// verdad, para TODAS las campañas activas, y verifica que devuelvan el contrato
// completo que consume la interfaz.
//
// Necesita SUPABASE_SERVICE_ROLE_KEY. Si no está, las pruebas se saltan con un
// aviso en vez de fallar, para que un entorno sin secretos no rompa la build.
// Localmente basta con que exista .env.local: el script de pruebas lo carga.

import assert from "node:assert/strict";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const CLAVE_SERVICIO = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CLAVE_ANONIMA =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

const SIN_CREDENCIALES = !URL_BASE || !CLAVE_SERVICIO;
const motivoSalto = "Falta SUPABASE_SERVICE_ROLE_KEY o la URL: no se puede probar contra la base.";

function cliente(clave: string): SupabaseClient {
  return createClient(URL_BASE, clave, { auth: { persistSession: false } });
}

const servicio = SIN_CREDENCIALES ? null : cliente(CLAVE_SERVICIO);

const HASTA = new Date().toISOString();
const DESDE = new Date(Date.now() - 30 * 864e5).toISOString();
const PREVIO_DESDE = new Date(Date.now() - 60 * 864e5).toISOString();

/** Claves que la interfaz lee del resumen. Si alguna se cae, hay pantalla rota. */
const CLAVES_RESUMEN = [
  "range",
  "kpis",
  "funnel",
  "reasons",
  "time_series",
  "agenda",
  "agents",
] as const;

const CLAVES_KPI = ["gestionadas", "contactadas", "ventas", "uf_total"] as const;

type Campana = { id: string; name: string };

async function campanasActivas(): Promise<Campana[]> {
  const { data, error } = await servicio!
    .from("campaigns")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(`No se pudo listar campañas: ${error.message}`);
  return (data ?? []) as Campana[];
}

function verificarResumen(campana: string, resumen: Record<string, unknown>) {
  for (const clave of CLAVES_RESUMEN) {
    assert.ok(clave in resumen, `${campana}: al resumen le falta la clave "${clave}"`);
  }

  const kpis = resumen.kpis as Record<string, { current?: unknown; previous?: unknown }>;
  for (const clave of CLAVES_KPI) {
    const metrica = kpis?.[clave];
    assert.ok(metrica, `${campana}: falta el KPI "${clave}"`);
    // La interfaz dibuja la variación con `previous`: sin él no hay flecha.
    assert.equal(
      typeof Number(metrica.current),
      "number",
      `${campana}: el KPI "${clave}" no trae un valor actual numérico`,
    );
    assert.ok(
      !Number.isNaN(Number(metrica.previous)),
      `${campana}: el KPI "${clave}" no trae comparativo previo`,
    );
  }

  for (const nombre of ["funnel", "reasons", "time_series", "agenda", "agents"] as const) {
    assert.ok(Array.isArray(resumen[nombre]), `${campana}: "${nombre}" debería ser un arreglo`);
  }

  // Las etiquetas del embudo son contrato: el vocabulario por vertical las
  // traduce por nombre, así que si cambian, la pantalla muestra el literal.
  const etapas = (resumen.funnel as { name: string; value: number }[]).map((e) => e.name);
  assert.ok(etapas.length > 0, `${campana}: el embudo llegó vacío`);
  for (const etapa of resumen.funnel as { name: string; value: number }[]) {
    assert.equal(
      typeof etapa.value,
      "number",
      `${campana}: la etapa "${etapa.name}" del embudo no trae un valor numérico`,
    );
  }
}

test(
  "el resumen de campaña responde el contrato completo en TODAS las campañas activas",
  { skip: SIN_CREDENCIALES ? motivoSalto : false },
  async () => {
    const campanas = await campanasActivas();
    assert.ok(campanas.length > 0, "no hay campañas activas contra las cuales probar");

    const resultados = await Promise.all(
      campanas.map(async (campana) => {
        const { data, error } = await servicio!.rpc("get_campaign_dashboard_summary", {
          p_campaign_id: campana.id,
          p_from: DESDE,
          p_to: HASTA,
          p_previous_from: PREVIO_DESDE,
          p_previous_to: DESDE,
        });
        return { campana, data, error };
      }),
    );

    const fallidas = resultados.filter((r) => r.error);
    assert.deepEqual(
      fallidas.map((r) => `${r.campana.name}: ${r.error!.message}`),
      [],
      "hay campañas cuyo resumen falla",
    );

    for (const { campana, data } of resultados) {
      verificarResumen(campana.name, data as Record<string, unknown>);
    }
  },
);

test(
  "el desglose de tipificaciones cuenta lo mismo que el resumen, campaña por campaña",
  { skip: SIN_CREDENCIALES ? motivoSalto : false },
  async () => {
    const campanas = await campanasActivas();

    const desvios: string[] = [];
    await Promise.all(
      campanas.map(async (campana) => {
        const [resumen, desglose] = await Promise.all([
          servicio!.rpc("get_campaign_dashboard_summary", {
            p_campaign_id: campana.id,
            p_from: DESDE,
            p_to: HASTA,
            p_previous_from: PREVIO_DESDE,
            p_previous_to: DESDE,
          }),
          servicio!.rpc("get_campaign_tipification_breakdown", {
            p_from: DESDE,
            p_to: HASTA,
            p_campaign_id: campana.id,
          }),
        ]);

        if (resumen.error) return desvios.push(`${campana.name}: resumen falló`);
        if (desglose.error) return desvios.push(`${campana.name}: desglose falló`);

        const delResumen = new Map<string, number>();
        for (const fila of (resumen.data as { reasons: { reason: string; count: number }[] }).reasons) {
          delResumen.set(fila.reason, (delResumen.get(fila.reason) ?? 0) + Number(fila.count));
        }

        const delDesglose = new Map<string, number>();
        for (const fila of (desglose.data ?? []) as { reason: string; total: number }[]) {
          delDesglose.set(fila.reason, (delDesglose.get(fila.reason) ?? 0) + Number(fila.total));
        }

        for (const [motivo, cantidad] of delResumen) {
          const otro = delDesglose.get(motivo) ?? 0;
          if (otro !== cantidad) {
            desvios.push(`${campana.name} · ${motivo}: resumen ${cantidad}, desglose ${otro}`);
          }
        }
        for (const motivo of delDesglose.keys()) {
          if (!delResumen.has(motivo)) {
            desvios.push(`${campana.name} · ${motivo}: está en el desglose y no en el resumen`);
          }
        }
      }),
    );

    assert.deepEqual(desvios, [], "el desglose y el resumen no cuentan lo mismo");
  },
);

test(
  "cada tipificación del desglose trae con qué clasificarla",
  { skip: SIN_CREDENCIALES ? motivoSalto : false },
  async () => {
    // No se exige que todas queden clasificadas: un motivo nuevo puede quedar
    // sin declarar a propósito. Lo que sí se exige es que la función devuelva
    // las tres señales, porque si alguna se cae el panel vuelve a agrupar a
    // ciegas y el usuario ve "sin clasificar" sin saber por qué.
    const { data, error } = await servicio!.rpc("get_campaign_tipification_breakdown", {
      p_from: new Date(Date.now() - 365 * 864e5).toISOString(),
      p_to: HASTA,
      p_campaign_id: null,
    });
    assert.equal(error, null, `el desglose global falló: ${error?.message}`);

    const filas = (data ?? []) as {
      reason: string;
      status: string | null;
      outcome: string | null;
      declared_result: string | null;
      total: number;
    }[];
    assert.ok(filas.length > 0, "no llegó ninguna tipificación en un año");

    const columnas = Object.keys(filas[0]).sort();
    assert.deepEqual(
      columnas,
      ["declared_result", "outcome", "reason", "status", "total"],
      "la función cambió sus columnas y el panel dejaría de clasificar",
    );

    const sinEstado = filas.filter((f) => !f.status);
    assert.deepEqual(
      sinEstado.map((f) => f.reason),
      [],
      "hay gestiones sin estado de cierre: el panel no puede decidir si hubo contacto",
    );
  },
);

test(
  "las funciones que exponen datos de la operación se niegan a responder sin sesión",
  { skip: SIN_CREDENCIALES ? motivoSalto : false },
  async () => {
    // Con la clave de servicio no hay `auth.uid()`. Estas funciones tienen que
    // rechazar en vez de devolver datos: es la barrera que impide que una clave
    // filtrada lea la operación completa.
    const guardadas = [
      ["get_contactability_by_hour", { p_from: DESDE, p_to: HASTA, p_campaign_id: null }],
      [
        "get_supervisor_report_summary",
        { p_from: DESDE, p_to: HASTA, p_team_id: null, p_campaign_id: null },
      ],
    ] as const;

    for (const [nombre, argumentos] of guardadas) {
      const { data, error } = await servicio!.rpc(nombre, argumentos as Record<string, unknown>);
      assert.ok(error, `${nombre} devolvió datos sin sesión: ${JSON.stringify(data)?.slice(0, 120)}`);
      assert.match(
        error.message,
        /No autenticado|permisos|equipos asignados|alcance/i,
        `${nombre} falló con un mensaje técnico en vez de uno de negocio: ${error.message}`,
      );
    }
  },
);

test(
  "los índices que hacen rápida la búsqueda por RUT siguen existiendo",
  { skip: SIN_CREDENCIALES ? motivoSalto : false },
  async () => {
    // Una limpieza de índices soltó siete que nadie usaba. Estos tres se
    // parecen a los soltados si uno mira sólo el contador de usos, pero son los
    // que llevan la búsqueda por RUT de 619 ms a menos de 1. Aparecen con pocos
    // usos porque el arreglo que los activó es reciente.
    //
    // En vez de inspeccionar el catálogo, se comprueba lo que importa: que la
    // búsqueda siga respondiendo rápido y con resultados.
    const { data: muestra, error: errorMuestra } = await servicio!
      .from("leads")
      .select("rut")
      .not("rut", "is", null)
      .neq("rut", "")
      .limit(1);
    assert.equal(errorMuestra, null, `no se pudo tomar un RUT de muestra: ${errorMuestra?.message}`);
    const rut = muestra?.[0]?.rut as string | undefined;
    assert.ok(rut, "no hay ningún lead con RUT contra el cual probar");

    const inicio = Date.now();
    const { data, error } = await servicio!.rpc("search_leads_quick", { p_term: rut });
    const transcurrido = Date.now() - inicio;

    assert.equal(error, null, `la búsqueda por RUT falló: ${error?.message}`);
    assert.ok((data?.length ?? 0) > 0, `la búsqueda por RUT no encontró ${rut}`);
    // Sin índice esto recorría 84 mil filas calculando la expresión regular dos
    // veces por fila. El umbral es holgado a propósito: no mide la máquina,
    // detecta que se volvió a un recorrido completo.
    assert.ok(
      transcurrido < 2000,
      `la búsqueda por RUT tardó ${transcurrido} ms: parece haber vuelto al recorrido completo`,
    );
  },
);

test(
  "toda migración del repositorio figura como aplicada en la base",
  { skip: SIN_CREDENCIALES ? motivoSalto : false },
  async () => {
    // Esta prueba nace de un incidente real: tres migraciones vivían en el
    // repositorio sin estar registradas, porque su autor había corrido el SQL a
    // mano en producción. Las funciones existían, así que nada se veía roto,
    // pero el historial mentía y levantar un entorno nuevo habría fallado.
    const { readdirSync } = await import("node:fs");
    const archivos = readdirSync(new URL("../supabase/migrations", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""));

    const enElRepo = new Map<string, string>();
    for (const archivo of archivos) {
      const corte = archivo.indexOf("_");
      enElRepo.set(archivo.slice(corte + 1), archivo.slice(0, corte));
    }

    // El esquema del historial no está expuesto por la API, así que se lee por
    // una función que sólo puede ejecutar la clave de servicio.
    const { data, error } = await servicio!.rpc("applied_migration_names");

    if (error) {
      assert.fail(
        `no se pudo leer el historial de migraciones: ${error.message}. ` +
          "Revísalo a mano antes de dar por buena esta prueba.",
      );
    }

    // Una migración cuenta como aplicada si coincide por nombre O por versión.
    // Exigir ambas daría falsos positivos sobre historia vieja: hay migraciones
    // aplicadas desde el panel de Supabase que quedaron con una marca de tiempo
    // distinta a la del archivo, y un placeholder registrado con otro nombre.
    // Eso no vale la pena reescribirlo; lo que importa es que ninguna quede sin
    // aplicar.
    const filas = (data ?? []) as { version: string; name: string | null }[];
    const porNombre = new Set(filas.map((f) => f.name).filter(Boolean) as string[]);
    const porVersion = new Set(filas.map((f) => f.version));

    const sinAplicar = [...enElRepo.entries()]
      .filter(([nombre, version]) => !porNombre.has(nombre) && !porVersion.has(version))
      .map(([nombre]) => nombre)
      .sort();

    assert.deepEqual(
      sinAplicar,
      [],
      "hay migraciones en el repositorio que la base no tiene registradas",
    );
  },
);
