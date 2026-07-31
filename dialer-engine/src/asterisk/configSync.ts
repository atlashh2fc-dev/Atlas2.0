import type AmiClient from "asterisk-manager";
import { logger } from "../logger";

/**
 * Sincroniza configuración de Asterisk (PJSIP de agentes + colas) a partir
 * de lo que hay en Supabase, usando solo AMI (el motor ya sostiene esa
 * conexión; no hay SSH entre dialer-engine y asterisk-atlas). Todo es
 * idempotente: antes de crear algo se chequea si ya existe vía GetConfig,
 * así correr esto en un intervalo no duplica categorías ni pisa a mano lo
 * que ya se configuró manualmente (6001/6002/qa_test_queue).
 */

export function amiAction(
  ami: AmiClient,
  action: Record<string, string | number | boolean | undefined>
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ami.action(action, (err, res) => {
      if (err) {
        reject(new Error(typeof err === "object" ? JSON.stringify(err) : String(err)));
        return;
      }
      resolve(res as Record<string, unknown>);
    });
  });
}

type ConfigSnapshot = {
  categories: Set<string>;
  variablesByCategory: Map<string, Map<string, string>>;
};

/**
 * GetConfig enumera categorías y líneas con índices correlativos:
 * `Category-000001` + `Line-000001-000002`. Conservamos los valores sólo en
 * memoria para poder comparar configuración declarada con la fuente de verdad;
 * nunca se incluyen en logs (algunas líneas contienen secretos SIP).
 */
export function parseConfigSnapshot(res: Record<string, unknown>): ConfigSnapshot {
  const categoryByIndex = new Map<string, string>();
  const categories = new Set<string>();
  const variablesByCategory = new Map<string, Map<string, string>>();

  for (const [key, value] of Object.entries(res)) {
    const match = /^category-(\d+)$/i.exec(key);
    if (!match || typeof value !== "string") continue;
    const category = value.replace(/\([^)]*\)$/, "").trim();
    categoryByIndex.set(match[1], category);
    categories.add(category);
    if (!variablesByCategory.has(category)) variablesByCategory.set(category, new Map());
  }

  for (const [key, value] of Object.entries(res)) {
    const match = /^line-(\d+)-(\d+)$/i.exec(key);
    if (!match || typeof value !== "string") continue;
    const category = categoryByIndex.get(match[1]);
    if (!category) continue;
    const separator = value.indexOf("=");
    if (separator < 0) continue;
    const variable = value.slice(0, separator).trim();
    const variableValue = value.slice(separator + 1).trim();
    if (variable) variablesByCategory.get(category)?.set(variable, variableValue);
  }

  return { categories, variablesByCategory };
}

async function getConfigSnapshot(ami: AmiClient, filename: string): Promise<ConfigSnapshot> {
  // Asterisk excluye las categorías template de GetConfig por defecto. Sin
  // este filtro el motor cree que faltan y trata de recrearlas en cada ciclo.
  const res = await amiAction(ami, {
    Action: "GetConfig",
    Filename: filename,
    Filter: "TEMPLATES=include",
  });
  return parseConfigSnapshot(res);
}

function buildUpdateConfigAction(
  filename: string,
  lines: {
    action: "NewCat" | "Append" | "Update";
    cat: string;
    varName?: string;
    value?: string;
    options?: string;
  }[]
): Record<string, string> {
  const action: Record<string, string> = {
    Action: "UpdateConfig",
    SrcFilename: filename,
    DstFilename: filename,
    Reload: "yes",
  };
  lines.forEach((line, idx) => {
    const i = String(idx).padStart(6, "0");
    action[`Action-${i}`] = line.action;
    action[`Cat-${i}`] = line.cat;
    if (line.varName !== undefined) action[`Var-${i}`] = line.varName;
    if (line.value !== undefined) action[`Value-${i}`] = line.value;
    if (line.options !== undefined) action[`Options-${i}`] = line.options;
  });
  return action;
}

const AGENT_ENDPOINT_TEMPLATE = "atlas-agent-endpoint-template";
const AGENT_AOR_TEMPLATE = "atlas-agent-aor-template";
const OUTBOUND_QUEUE_STRATEGY = "leastrecent";

type ConfigLine = {
  action: "NewCat" | "Append" | "Update";
  cat: string;
  varName?: string;
  value?: string;
  options?: string;
};

/**
 * UpdateConfig puede devolver un error que incluya el action original. Como
 * ese action contiene la contraseña SIP, reemplazamos el error antes de que
 * llegue al logger. La extensión se registra en el caller, nunca el secreto.
 */
async function applyAgentPjsipConfig(ami: AmiClient, lines: ConfigLine[]): Promise<void> {
  try {
    await amiAction(ami, buildUpdateConfigAction("pjsip.conf", lines));
  } catch {
    throw new Error("AMI rechazó la actualización de configuración PJSIP del agente");
  }
}

async function ensureAgentTemplates(
  ami: AmiClient,
  existing: Set<string>
): Promise<boolean> {
  if (existing.has(AGENT_ENDPOINT_TEMPLATE) && existing.has(AGENT_AOR_TEMPLATE)) {
    return true;
  }

  const lines: {
    action: "NewCat" | "Append";
    cat: string;
    varName?: string;
    value?: string;
    options?: string;
  }[] = [];

  if (!existing.has(AGENT_ENDPOINT_TEMPLATE)) {
    lines.push(
      { action: "NewCat", cat: AGENT_ENDPOINT_TEMPLATE, options: "template" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "type", value: "endpoint" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "context", value: "agents-outbound" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "disallow", value: "all" },
      // Siptel negocia PCMA/alaw en la pata PSTN. Chrome/SIP.js también
      // soporta PCMA, por lo que fijarlo aquí mantiene audio nativo extremo
      // a extremo y evita la traducción defectuosa de Asterisk 18.10.
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "allow", value: "alaw" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "transport", value: "transport-wss" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "webrtc", value: "yes" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "direct_media", value: "no" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "use_avpf", value: "yes" },
      {
        action: "Append",
        cat: AGENT_ENDPOINT_TEMPLATE,
        varName: "media_use_received_transport",
        value: "yes",
      },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "rtp_symmetric", value: "yes" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "force_rport", value: "yes" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "rewrite_contact", value: "yes" },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "ice_support", value: "yes" },
      {
        action: "Append",
        cat: AGENT_ENDPOINT_TEMPLATE,
        varName: "dtls_auto_generate_cert",
        value: "yes",
      },
      { action: "Append", cat: AGENT_ENDPOINT_TEMPLATE, varName: "language", value: "es" }
    );
  }

  if (!existing.has(AGENT_AOR_TEMPLATE)) {
    lines.push(
      { action: "NewCat", cat: AGENT_AOR_TEMPLATE, options: "template" },
      { action: "Append", cat: AGENT_AOR_TEMPLATE, varName: "type", value: "aor" },
      { action: "Append", cat: AGENT_AOR_TEMPLATE, varName: "max_contacts", value: "3" }
    );
  }

  for (const line of lines) {
    if (
      line.action === "Append" &&
      (line.cat === AGENT_ENDPOINT_TEMPLATE || line.cat === AGENT_AOR_TEMPLATE)
    ) {
      line.options = 'catfilter="TEMPLATES=restrict"';
    }
  }

  try {
    await amiAction(ami, buildUpdateConfigAction("pjsip.conf", lines));
    existing.add(AGENT_ENDPOINT_TEMPLATE);
    existing.add(AGENT_AOR_TEMPLATE);
    logger.info("Templates PJSIP de agentes verificados");
    return true;
  } catch (err) {
    logger.error({ err }, "No se pudieron crear los templates PJSIP de agentes");
    return false;
  }
}

/**
 * Reconcilia el endpoint PJSIP WebRTC de un agente: lo crea si falta y, si ya
 * existe, compara su auth con la credencial vigente de Supabase. Endpoint y
 * AOR comparten la extensión, tal como requiere el registro dinámico de
 * PJSIP; son objetos distintos y heredan templates separados. El auth vive en
 * "<ext>-auth". Así REGISTER y Dial(PJSIP/<ext>) usan el mismo identificador.
 */
export async function ensureAgentEndpoints(
  ami: AmiClient,
  agents: { extension: string; sipPassword: string }[]
): Promise<void> {
  if (agents.length === 0) return;

  let snapshot: ConfigSnapshot;
  try {
    snapshot = await getConfigSnapshot(ami, "pjsip.conf");
  } catch (err) {
    logger.error({ err }, "GetConfig pjsip.conf falló; se salta el sync de extensiones este ciclo");
    return;
  }

  if (!(await ensureAgentTemplates(ami, snapshot.categories))) return;

  for (const agent of agents) {
    const authCat = `${agent.extension}-auth`;

    if (snapshot.categories.has(agent.extension)) {
      const authVariables = snapshot.variablesByCategory.get(authCat);
      const endpointVariables = snapshot.variablesByCategory.get(agent.extension);
      const lines: ConfigLine[] = [];

      if (!snapshot.categories.has(authCat)) {
        // Repara aprovisionamientos parciales: un endpoint sin auth nunca podrá
        // aceptar REGISTER aunque la extensión ya exista en pjsip.conf.
        lines.push(
          { action: "NewCat", cat: authCat },
          { action: "Append", cat: authCat, varName: "type", value: "auth" },
          { action: "Append", cat: authCat, varName: "auth_type", value: "userpass" },
          { action: "Append", cat: authCat, varName: "username", value: agent.extension },
          { action: "Append", cat: authCat, varName: "password", value: agent.sipPassword }
        );
      } else if (authVariables?.get("password") !== agent.sipPassword) {
        // Update requiere que la variable exista; Append cubre categorías auth
        // antiguas o incompletas que todavía no tienen `password`.
        lines.push({
          action: authVariables?.has("password") ? "Update" : "Append",
          cat: authCat,
          varName: "password",
          value: agent.sipPassword,
        });
      }

      if (endpointVariables?.get("aors") !== agent.extension) {
        lines.push({
          action: endpointVariables?.has("aors") ? "Update" : "Append",
          cat: agent.extension,
          varName: "aors",
          value: agent.extension,
        });
      }
      if (endpointVariables?.get("auth") !== authCat) {
        lines.push({
          action: endpointVariables?.has("auth") ? "Update" : "Append",
          cat: agent.extension,
          varName: "auth",
          value: authCat,
        });
      }

      if (lines.length === 0) continue;
      try {
        await applyAgentPjsipConfig(ami, lines);
        snapshot.categories.add(authCat);
        logger.info(
          { extension: agent.extension },
          "Configuración PJSIP de agente reconciliada con el directorio"
        );
      } catch (err) {
        logger.error(
          { err, extension: agent.extension },
          "No se pudo reconciliar el endpoint PJSIP del agente"
        );
      }
      continue;
    }

    const lines: ConfigLine[] = [
      { action: "NewCat", cat: authCat },
      { action: "Append", cat: authCat, varName: "type", value: "auth" },
      { action: "Append", cat: authCat, varName: "auth_type", value: "userpass" },
      { action: "Append", cat: authCat, varName: "username", value: agent.extension },
      { action: "Append", cat: authCat, varName: "password", value: agent.sipPassword },
      {
        action: "NewCat",
        cat: agent.extension,
        options: `inherit="${AGENT_ENDPOINT_TEMPLATE}"`,
      },
      { action: "Append", cat: agent.extension, varName: "aors", value: agent.extension },
      { action: "Append", cat: agent.extension, varName: "auth", value: authCat },
      {
        action: "NewCat",
        cat: agent.extension,
        options: `allowdups,inherit="${AGENT_AOR_TEMPLATE}"`,
      },
    ];

    try {
      await applyAgentPjsipConfig(ami, lines);
      snapshot.categories.add(agent.extension);
      snapshot.categories.add(authCat);
      logger.info({ extension: agent.extension }, "Endpoint PJSIP creado para agente nuevo");
    } catch (err) {
      logger.error({ err, extension: agent.extension }, "No se pudo crear el endpoint PJSIP del agente");
    }
  }
}

/**
 * Rota la clave de un endpoint ya aprovisionado. Se usa únicamente al cerrar
 * una sesión por administración; UpdateConfig recarga PJSIP en la misma
 * operación y evita que una credencial copiada vuelva a registrar el agente.
 */
export async function updateAgentSipPassword(
  ami: AmiClient,
  extension: string,
  sipPassword: string
): Promise<void> {
  await applyAgentPjsipConfig(ami, [
    {
      action: "Update",
      cat: `${extension}-auth`,
      varName: "password",
      value: sipPassword,
    },
  ]);
}

const AMD_CONTEXT = "dialer-amd-out";

/**
 * Contexto de dialplan dedicado para campañas con AMD habilitado
 * (dialer_campaign_configs.amd_enabled): corre AMD() al contestar y solo
 * deja pasar a la Queue si detecta un humano; si detecta contestador/
 * voicemail, corta sin conectar a un agente. QUEUE_NAME llega como
 * variable de canal seteada en el Originate (originate.ts) — el contexto
 * es el mismo para todas las campañas con AMD, no hace falta un contexto
 * por campaña.
 *
 * Se crea una sola vez al arrancar el motor (idempotente vía GetConfig, no
 * pisa nada si ya existe) y nunca se toca de nuevo — a diferencia de
 * queues.conf/pjsip.conf, este contexto no cambia con la config de ninguna
 * campaña en particular.
 */
export async function ensureAmdContext(ami: AmiClient): Promise<void> {
  let existing: Set<string>;
  try {
    existing = (await getConfigSnapshot(ami, "extensions.conf")).categories;
  } catch (err) {
    logger.error({ err }, "GetConfig extensions.conf falló; se salta el sync del contexto AMD este ciclo");
    return;
  }
  if (existing.has(AMD_CONTEXT)) return;

  const lines: { action: "NewCat" | "Append"; cat: string; varName?: string; value?: string }[] = [
    { action: "NewCat", cat: AMD_CONTEXT },
    {
      action: "Append",
      cat: AMD_CONTEXT,
      varName: "exten",
      value: "s,1,NoOp(AMD check dial_attempt=${DIAL_ATTEMPT_ID})",
    },
    { action: "Append", cat: AMD_CONTEXT, varName: "exten", value: "s,2,Answer()" },
    { action: "Append", cat: AMD_CONTEXT, varName: "exten", value: "s,3,AMD()" },
    {
      action: "Append",
      cat: AMD_CONTEXT,
      varName: "exten",
      value: "s,4,UserEvent(AMDResult,AMDStatus: ${AMDSTATUS},DialAttemptId: ${DIAL_ATTEMPT_ID})",
    },
    {
      action: "Append",
      cat: AMD_CONTEXT,
      varName: "exten",
      value: 's,5,GotoIf($["${AMDSTATUS}" = "MACHINE"]?7:6)',
    },
    { action: "Append", cat: AMD_CONTEXT, varName: "exten", value: "s,6,Queue(${QUEUE_NAME})" },
    { action: "Append", cat: AMD_CONTEXT, varName: "exten", value: "s,7,Hangup()" },
  ];

  try {
    await amiAction(ami, buildUpdateConfigAction("extensions.conf", lines));
    logger.info({ context: AMD_CONTEXT }, "Contexto AMD creado en extensions.conf");
  } catch (err) {
    logger.error({ err }, "No se pudo crear el contexto AMD");
  }
}

const lastQueueConfigByName = new Map<string, { wrapupSeconds: number; strategy: string }>();

/**
 * Crea la cola en queues.conf si no existe (con defaults razonables) o
 * sincroniza estrategia y wrapuptime ("tiempo entre llamadas") desde el CRM.
 */
export async function ensureQueue(ami: AmiClient, queueName: string, wrapupSeconds: number): Promise<void> {
  let existing: Set<string>;
  try {
    existing = (await getConfigSnapshot(ami, "queues.conf")).categories;
  } catch (err) {
    logger.error({ err, queueName }, "GetConfig queues.conf falló; la campaña no puede originar este ciclo");
    throw err;
  }

  if (!existing.has(queueName)) {
    const lines: { action: "NewCat" | "Append"; cat: string; varName?: string; value?: string }[] = [
      { action: "NewCat", cat: queueName },
      { action: "Append", cat: queueName, varName: "strategy", value: OUTBOUND_QUEUE_STRATEGY },
      { action: "Append", cat: queueName, varName: "timeout", value: "20" },
      { action: "Append", cat: queueName, varName: "retry", value: "5" },
      { action: "Append", cat: queueName, varName: "wrapuptime", value: String(wrapupSeconds) },
      { action: "Append", cat: queueName, varName: "maxlen", value: "0" },
      { action: "Append", cat: queueName, varName: "joinempty", value: "yes" },
      { action: "Append", cat: queueName, varName: "leavewhenempty", value: "no" },
      { action: "Append", cat: queueName, varName: "autofill", value: "yes" },
      { action: "Append", cat: queueName, varName: "language", value: "es" },
    ];
    try {
      await amiAction(ami, buildUpdateConfigAction("queues.conf", lines));
      lastQueueConfigByName.set(queueName, {
        wrapupSeconds,
        strategy: OUTBOUND_QUEUE_STRATEGY,
      });
      logger.info({ queueName, wrapupSeconds }, "Cola creada en Asterisk");
    } catch (err) {
      logger.error({ err, queueName }, "No se pudo crear la cola en Asterisk");
      throw err;
    }
    return;
  }

  const lastConfig = lastQueueConfigByName.get(queueName);
  if (
    lastConfig?.wrapupSeconds === wrapupSeconds
    && lastConfig.strategy === OUTBOUND_QUEUE_STRATEGY
  ) return;

  try {
    await amiAction(
      ami,
      buildUpdateConfigAction("queues.conf", [
        { action: "Update", cat: queueName, varName: "strategy", value: OUTBOUND_QUEUE_STRATEGY },
        { action: "Update", cat: queueName, varName: "wrapuptime", value: String(wrapupSeconds) },
      ])
    );
    lastQueueConfigByName.set(queueName, {
      wrapupSeconds,
      strategy: OUTBOUND_QUEUE_STRATEGY,
    });
    logger.info(
      { queueName, wrapupSeconds, strategy: OUTBOUND_QUEUE_STRATEGY },
      "Configuración de la cola actualizada desde el CRM"
    );
  } catch (err) {
    logger.error(
      { err, queueName, wrapupSeconds, strategy: OUTBOUND_QUEUE_STRATEGY },
      "No se pudo actualizar la configuración de la cola"
    );
    throw err;
  }
}

function extensionFromQueueInterface(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^PJSIP\/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * QueueStatus es la fuente viva de miembros. El cache local anterior podía
 * sobrevivir a errores y creer que un miembro dinámico seguía en Asterisk.
 */
async function getCurrentQueueMembers(ami: AmiClient, queueName: string): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const actionId = `atlas-queue-status-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const members = new Set<string>();
    let finished = false;

    const cleanup = () => {
      clearTimeout(timer);
      ami.removeListener("managerevent", onEvent);
    };
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (err) reject(err);
      else resolve(members);
    };
    const onEvent = (evt: Record<string, unknown>) => {
      if (String(evt.actionid ?? "") !== actionId) return;
      const event = String(evt.event ?? "").toLowerCase();
      if (event === "queuemember") {
        const extension = extensionFromQueueInterface(
          evt.location ?? evt.interface ?? evt.name
        );
        if (extension) members.add(extension);
      } else if (event === "queuestatuscomplete") {
        finish();
      }
    };
    const timer = setTimeout(
      () => finish(new Error(`QueueStatus timeout para ${queueName}`)),
      5_000
    );

    ami.on("managerevent", onEvent);
    ami.action(
      { Action: "QueueStatus", Queue: queueName, actionid: actionId },
      (err) => {
        if (err) finish(new Error(typeof err === "object" ? JSON.stringify(err) : String(err)));
      }
    );
  });
}

/**
 * Miembros dinámicos de cola (QueueAdd/QueueRemove) — no tocan queues.conf,
 * viven en memoria de Asterisk. Se re-sincronizan agentes asignados a la
 * campaña (campaign_agents) que tengan extensión activa.
 */
export async function syncQueueMembers(
  ami: AmiClient,
  queueName: string,
  desiredExtensions: string[]
): Promise<boolean> {
  const desired = new Set(desiredExtensions);
  const current = await getCurrentQueueMembers(ami, queueName);
  let changed = false;

  for (const ext of desired) {
    if (current.has(ext)) continue;
    await amiAction(ami, {
      Action: "QueueAdd",
      Queue: queueName,
      Interface: `PJSIP/${ext}`,
      MemberName: ext,
      Paused: "false",
    });
    changed = true;
    logger.info({ queueName, ext }, "Agente agregado a la cola");
  }

  for (const ext of current) {
    if (desired.has(ext)) continue;
    await amiAction(ami, { Action: "QueueRemove", Queue: queueName, Interface: `PJSIP/${ext}` });
    changed = true;
    logger.info({ queueName, ext }, "Agente quitado de la cola");
  }

  return changed;
}
