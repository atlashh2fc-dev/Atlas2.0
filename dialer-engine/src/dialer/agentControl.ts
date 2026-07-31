import { hostname } from "node:os";
import type AmiClient from "asterisk-manager";
import { logger } from "../logger";
import {
  claimAgentControlCommands,
  completeAgentControlCommand,
  type AgentControlCommand,
} from "../supabaseClient";
import { amiAction, updateAgentSipPassword } from "../asterisk/configSync";

const ACTION_TIMEOUT_MS = 5_000;
export const AGENT_CONTROL_POLL_MS = 1_000;
const workerId = `${hostname()}:${process.pid}`;

function collectAmiEvents(
  ami: AmiClient,
  action: Record<string, string>,
  completeEvent: string,
  onEvent: (event: Record<string, unknown>) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const actionId = `atlas-control-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ami.removeListener("managerevent", listener);
      if (error) reject(error);
      else resolve();
    };
    const listener = (event: Record<string, unknown>) => {
      if (String(event.actionid ?? "") !== actionId) return;
      const name = String(event.event ?? "").toLowerCase();
      if (name === completeEvent) finish();
      else onEvent(event);
    };
    const timer = setTimeout(
      () => finish(new Error(`${action.Action} no respondió dentro del plazo`)),
      ACTION_TIMEOUT_MS
    );
    ami.on("managerevent", listener);
    ami.action({ ...action, actionid: actionId }, (error) => {
      if (error) finish(new Error(typeof error === "object" ? JSON.stringify(error) : String(error)));
    });
  });
}

async function listAgentChannels(ami: AmiClient, extension: string): Promise<string[]> {
  const channels = new Set<string>();
  await collectAmiEvents(ami, { Action: "CoreShowChannels" }, "coreshowchannelscomplete", (event) => {
    if (String(event.event ?? "").toLowerCase() !== "coreshowchannel") return;
    const channel = String(event.channel ?? "");
    if (channel.startsWith(`PJSIP/${extension}-`)) channels.add(channel);
  });
  return [...channels];
}

async function countAgentContacts(ami: AmiClient, extension: string): Promise<number> {
  let count = 0;
  await collectAmiEvents(ami, { Action: "PJSIPShowContacts" }, "contactlistcomplete", (event) => {
    if (String(event.event ?? "").toLowerCase() !== "contactlist") return;
    const endpoint = String(event.endpointname ?? event.endpoint ?? "");
    const objectName = String(event.objectname ?? "");
    const uri = String(event.uri ?? "");
    if (
      endpoint === extension ||
      objectName.startsWith(`${extension};`) ||
      uri.includes(`sip:${extension}@`)
    ) count += 1;
  });
  return count;
}

async function executeCommand(ami: AmiClient, command: AgentControlCommand) {
  const criticalErrors: string[] = [];
  const result: Record<string, unknown> = {
    extension: command.extension,
    queue_paused: false,
    sip_password_rotated: false,
    channels_hung_up: [],
    contacts_remaining: null,
    contact_removal_supported: false,
  };

  try {
    await amiAction(ami, {
      Action: "QueuePause",
      Interface: `PJSIP/${command.extension}`,
      Paused: "true",
      Reason: "Cierre remoto por administrador",
    });
    result.queue_paused = true;
  } catch (error) {
    // Puede no pertenecer todavía a una cola; la base ya lo dejó offline y el
    // sync de membresías lo removerá. Se registra, pero no impide el Hangup.
    result.queue_pause_error = error instanceof Error ? error.message : String(error);
  }

  try {
    await updateAgentSipPassword(ami, command.extension, command.sip_password);
    result.sip_password_rotated = true;
  } catch (error) {
    criticalErrors.push(`rotación SIP: ${error instanceof Error ? error.message : String(error)}`);
  }

  let channels: string[] = [];
  try {
    channels = await listAgentChannels(ami, command.extension);
  } catch (error) {
    criticalErrors.push(`listar canales: ${error instanceof Error ? error.message : String(error)}`);
  }
  const hungUp: string[] = [];
  for (const channel of channels) {
    try {
      await amiAction(ami, { Action: "Hangup", Channel: channel, Cause: "16" });
      hungUp.push(channel);
    } catch (error) {
      criticalErrors.push(`colgar ${channel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  result.channels_hung_up = hungUp;

  // Asterisk 18.10 de producción puede listar contactos, pero no ofrece un
  // comando soportado para borrarlos. El navegador envía unregister; si está
  // fuera de línea, QueuePause + rotación de auth impiden cualquier llamada y
  // el contacto registral viejo expira por su propio TTL.
  try {
    result.contacts_remaining = await countAgentContacts(ami, command.extension);
  } catch (error) {
    result.contact_verification_error = error instanceof Error ? error.message : String(error);
  }
  if (criticalErrors.length) throw new Error(criticalErrors.join("; "));
  return result;
}

export async function processAgentControlCommands(ami: AmiClient): Promise<void> {
  const commands = await claimAgentControlCommands(workerId);
  for (const command of commands) {
    try {
      const result = await executeCommand(ami, command);
      await completeAgentControlCommand({ commandId: command.command_id, success: true, result });
      logger.info(
        { commandId: command.command_id, profileId: command.profile_id, result },
        "Cierre remoto de agente confirmado por PBX"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await completeAgentControlCommand({
        commandId: command.command_id,
        success: false,
        result: { extension: command.extension },
        error: message,
      }).catch((completeError) =>
        logger.error({ completeError, commandId: command.command_id }, "No se pudo reprogramar la orden")
      );
      logger.error({ error, commandId: command.command_id }, "Cierre remoto PBX falló; se reintentará");
    }
  }
}
