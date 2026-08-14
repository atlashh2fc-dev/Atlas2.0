import type AmiClient from "asterisk-manager";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { logger } from "../logger";
import { amiAction } from "../asterisk/configSync";
import {
  createRecordingIngestGrant,
  getRecordingContext,
  persistRecordingCompletion,
  persistRecordingState,
} from "./storage";
import type { RecordingCoordinator, RecordingDisconnectParty, RecordingJob } from "./types";
import { buildRecordingUploadCommand } from "./command";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;

function storagePathFor(startedAt: string, dialAttemptId: string): string {
  const date = new Date(startedAt);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}/${dialAttemptId}.opus`;
}

/**
 * Corre en la EC2 del dialer. Sólo controla MixMonitor vía AMI; todos los
 * paths pertenecen al filesystem de la EC2 Asterisk, no al de este proceso.
 */
export class AmiRecordingController implements RecordingCoordinator {
  private readonly active = new Map<string, RecordingJob>();

  constructor(
    private readonly ami: AmiClient,
    private readonly spoolDirOnAsterisk: string,
    private readonly bucket: string,
    private readonly ingestBaseUrl: string,
    private readonly uploadCommand: string,
    private readonly tokenTtlSeconds: number
  ) {}

  async start(params: {
    dialAttemptId: string;
    callId: string;
    agentId: string;
    campaignId?: string | null;
    channel: string;
  }): Promise<void> {
    if (!SAFE_ID.test(params.dialAttemptId)) throw new Error("dial_attempt_id inseguro para filename");
    if (!params.channel) throw new Error("AgentConnect no informó canal para MixMonitor");
    if (this.active.has(params.dialAttemptId)) return;

    const context = await getRecordingContext(params.dialAttemptId, params.callId, params.agentId);
    if (params.campaignId && params.campaignId !== context.campaignId) {
      throw new Error(`campaign_id inconsistente para dial_attempt ${params.dialAttemptId}`);
    }
    const wavPath = path.posix.join(this.spoolDirOnAsterisk, `${params.dialAttemptId}.wav`);
    const job: RecordingJob = {
      version: 1,
      dialAttemptId: params.dialAttemptId,
      callId: context.callId,
      leadId: context.leadId,
      campaignId: context.campaignId,
      agentId: context.agentId,
      channel: params.channel,
      startedAt: context.startedAt,
      endedAt: null,
      wavPath,
      opusPath: path.posix.join(this.spoolDirOnAsterisk, `${params.dialAttemptId}.partial.opus`),
      storagePath: storagePathFor(context.startedAt, params.dialAttemptId),
    };

    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const expiresAtDate = new Date(Date.now() + this.tokenTtlSeconds * 1000);
    const expiresAt = expiresAtDate.toISOString();
    await createRecordingIngestGrant({ job, bucket: this.bucket, tokenHash, expiresAt });

    // Todos los argumentos provienen de UUID/hex/URL/path validados, y además
    // se shell-quotean porque Asterisk ejecuta Command mediante /bin/sh.
    const uploadCommand = buildRecordingUploadCommand([
      this.uploadCommand,
      job.dialAttemptId,
      token,
      this.ingestBaseUrl,
      job.wavPath,
      String(Math.floor(expiresAtDate.getTime() / 1000)),
    ]);

    try {
      await amiAction(this.ami, {
        Action: "MixMonitor",
        Channel: job.channel,
        File: job.wavPath,
        Options: "b",
        Command: uploadCommand,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message.slice(0, 1_000) : String(err).slice(0, 1_000);
      await persistRecordingState({
        job,
        bucket: this.bucket,
        status: "failed",
        errorMessage,
      }).catch((persistErr) =>
        logger.error({ err: persistErr, dialAttemptId: job.dialAttemptId }, "No se pudo registrar fallo de MixMonitor")
      );
      throw err;
    }
    this.active.set(job.dialAttemptId, job);
    logger.info(
      { dialAttemptId: job.dialAttemptId, callId: job.callId },
      "MixMonitor iniciado al conectar agente"
    );
  }

  async stop(
    dialAttemptId: string,
    completion?: { disconnectParty: RecordingDisconnectParty | null; queueTalkSeconds: number | null }
  ): Promise<void> {
    const job = this.active.get(dialAttemptId);
    if (job) {
      await amiAction(this.ami, { Action: "StopMixMonitor", Channel: job.channel }).catch((err) =>
        logger.warn({ err, dialAttemptId }, "StopMixMonitor falló; Hangup cerrará MixMonitor")
      );
      this.active.delete(dialAttemptId);
    }
    // Se persiste aun si el proceso se reinició y perdió el mapa `active`:
    // la fila de grabación ya fue creada al comenzar MixMonitor.
    if (completion) {
      await persistRecordingCompletion(dialAttemptId, completion);
    }
  }
}
