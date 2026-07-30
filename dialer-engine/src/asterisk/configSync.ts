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

async function getExistingCategories(ami: AmiClient, filename: string): Promise<Set<string>> {
  // Asterisk excluye las categorías template de GetConfig por defecto. Sin
  // este filtro el motor cree que faltan y trata de recrearlas en cada ciclo.
  const res = await amiAction(ami, {
    Action: "GetConfig",
    Filename: filename,
    Filter: "TEMPLATES=include",
  });
  const names = new Set<string>();
  for (const [key, value] of Object.entries(res)) {
    if (key.toLowerCase().startsWith("category-") && typeof value === "string") {
      // GetConfig conserva el sufijo de herencia/template del encabezado
      // (`[nombre](!)` / `[nombre](base)`). Para idempotencia necesitamos
      // comparar la categoría real, no su declaración completa.
      names.add(value.replace(/\([^)]*\)$/, "").trim());
    }
  }
  return names;
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
 * Crea (si falta) el endpoint PJSIP WebRTC de un agente: aor + auth +
 * endpoint. Endpoint y AOR comparten la extensión, tal como requiere el
 * registro dinámico de PJSIP; son objetos distintos y heredan templates
 * separados. El auth vive en "<ext>-auth". Así REGISTER y
 * Dial(PJSIP/<ext>) usan el mismo identificador.
 */
export async function ensureAgentEndpoints(
  ami: AmiClient,
  agents: { extension: string; sipPassword: string }[]
): Promise<void> {
  if (agents.length === 0) return;

  let existing: Set<string>;
  try {
    existing = await getExistingCategories(ami, "pjsip.conf");
  } catch (err) {
    logger.error({ err }, "GetConfig pjsip.conf falló; se salta el sync de extensiones este ciclo");
    return;
  }

  if (!(await ensureAgentTemplates(ami, existing))) return;

  for (const agent of agents) {
    if (existing.has(agent.extension)) continue;

    const authCat = `${agent.extension}-auth`;

    const lines: {
      action: "NewCat" | "Append";
      cat: string;
      varName?: string;
      value?: string;
      options?: string;
    }[] = [
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
      await amiAction(ami, buildUpdateConfigAction("pjsip.conf", lines));
      existing.add(agent.extension);
      logger.info({ extension: agent.extension }, "Endpoint PJSIP creado para agente nuevo");
    } catch (err) {
      logger.error({ err, extension: agent.extension }, "No se pudo crear el endpoint PJSIP del agente");
    }
  }
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
    existing = await getExistingCategories(ami, "extensions.conf");
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

const lastWrapupByQueue = new Map<string, number>();

/**
 * Crea la cola en queues.conf si no existe (con defaults razonables) o
 * sincroniza wrapuptime ("tiempo entre llamadas") si cambió desde el CRM.
 */
export async function ensureQueue(ami: AmiClient, queueName: string, wrapupSeconds: number): Promise<void> {
  let existing: Set<string>;
  try {
    existing = await getExistingCategories(ami, "queues.conf");
  } catch (err) {
    logger.error({ err, queueName }, "GetConfig queues.conf falló; se salta el sync de cola este ciclo");
    return;
  }

  if (!existing.has(queueName)) {
    const lines: { action: "NewCat" | "Append"; cat: string; varName?: string; value?: string }[] = [
      { action: "NewCat", cat: queueName },
      { action: "Append", cat: queueName, varName: "strategy", value: "ringall" },
      { action: "Append", cat: queueName, varName: "timeout", value: "20" },
      { action: "Append", cat: queueName, varName: "retry", value: "5" },
      { action: "Append", cat: queueName, varName: "wrapuptime", value: String(wrapupSeconds) },
      { action: "Append", cat: queueName, varName: "maxlen", value: "0" },
      { action: "Append", cat: queueName, varName: "joinempty", value: "yes" },
      { action: "Append", cat: queueName, varName: "leavewhenempty", value: "no" },
      { action: "Append", cat: queueName, varName: "ring", value: "no" },
      { action: "Append", cat: queueName, varName: "language", value: "es" },
    ];
    try {
      await amiAction(ami, buildUpdateConfigAction("queues.conf", lines));
      lastWrapupByQueue.set(queueName, wrapupSeconds);
      logger.info({ queueName, wrapupSeconds }, "Cola creada en Asterisk");
    } catch (err) {
      logger.error({ err, queueName }, "No se pudo crear la cola en Asterisk");
    }
    return;
  }

  if (lastWrapupByQueue.get(queueName) === wrapupSeconds) return;

  try {
    await amiAction(
      ami,
      buildUpdateConfigAction("queues.conf", [
        { action: "Update", cat: queueName, varName: "wrapuptime", value: String(wrapupSeconds) },
      ])
    );
    lastWrapupByQueue.set(queueName, wrapupSeconds);
    logger.info({ queueName, wrapupSeconds }, "wrapuptime de la cola actualizado desde el CRM");
  } catch (err) {
    logger.error({ err, queueName, wrapupSeconds }, "No se pudo actualizar wrapuptime");
  }
}

const knownMembersByQueue = new Map<string, Set<string>>();

/**
 * Miembros dinámicos de cola (QueueAdd/QueueRemove) — no tocan queues.conf,
 * viven en memoria de Asterisk. Se re-sincronizan agentes asignados a la
 * campaña (campaign_agents) que tengan extensión activa.
 */
export async function syncQueueMembers(ami: AmiClient, queueName: string, desiredExtensions: string[]): Promise<void> {
  const desired = new Set(desiredExtensions);
  const known = knownMembersByQueue.get(queueName) ?? new Set<string>();

  for (const ext of desired) {
    if (known.has(ext)) continue;
    try {
      await amiAction(ami, {
        Action: "QueueAdd",
        Queue: queueName,
        Interface: `PJSIP/${ext}`,
        MemberName: ext,
        Paused: "false",
      });
      logger.info({ queueName, ext }, "Agente agregado a la cola");
    } catch {
      // Ya era miembro (p. ej. tras un reinicio del motor) — lo damos por sincronizado.
    }
    known.add(ext);
  }

  for (const ext of Array.from(known)) {
    if (desired.has(ext)) continue;
    try {
      await amiAction(ami, { Action: "QueueRemove", Queue: queueName, Interface: `PJSIP/${ext}` });
      logger.info({ queueName, ext }, "Agente quitado de la cola");
    } catch (err) {
      logger.warn({ err, queueName, ext }, "QueueRemove falló (¿ya no era miembro?)");
    }
    known.delete(ext);
  }

  knownMembersByQueue.set(queueName, known);
}
