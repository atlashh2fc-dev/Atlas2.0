import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import express from "express";
import { logger } from "../logger";
import {
  getRecordingIngestGrant,
  markRecordingIngested,
  persistRecordingState,
  uploadRecordingIdempotently,
} from "./storage";
import type { RecordingIngestGrant, RecordingMetadata } from "./types";

const SAFE_ID = /^[a-zA-Z0-9-]+$/;
const inFlight = new Map<string, Promise<void>>();

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validBearer(req: Request, grant: RecordingIngestGrant): boolean {
  const authorization = req.header("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const actual = Buffer.from(sha256(authorization.slice(7)), "hex");
  const expected = Buffer.from(grant.tokenHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function retry<T>(operation: () => Promise<T>, attempts: number, baseMs: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError;
}

export function registerRecordingIngestRoute(
  app: Express,
  config: { bucket: string; maxUploadMb: number; retryAttempts: number; retryBaseMs: number }
): void {
  app.post(
    "/internal/recordings/:dialAttemptId/ingest",
    express.raw({ type: "audio/ogg", limit: `${config.maxUploadMb}mb` }),
    async (req: Request, res: Response) => {
      const dialAttemptId = req.params.dialAttemptId;
      if (!SAFE_ID.test(dialAttemptId)) {
        res.status(400).json({ error: "dial_attempt_id inválido" });
        return;
      }
      const body = Buffer.isBuffer(req.body) ? req.body : null;
      const durationSeconds = Number(req.header("x-recording-duration-seconds"));
      if (!body || body.length === 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        res.status(400).json({ error: "Audio o duración inválidos" });
        return;
      }

      try {
        const grant = await getRecordingIngestGrant(dialAttemptId);
        if (!validBearer(req, grant)) {
          res.status(401).json({ error: "Token de ingestión inválido" });
          return;
        }
        if (new Date(grant.expiresAt).getTime() < Date.now()) {
          res.status(410).json({ error: "Token de ingestión expirado" });
          return;
        }
        if (grant.ingestedAt && grant.status === "ready") {
          res.status(200).json({ ok: true, idempotent: true });
          return;
        }

        let operation = inFlight.get(dialAttemptId);
        if (!operation) {
          operation = processIngest(grant, body, durationSeconds, config).finally(() =>
            inFlight.delete(dialAttemptId)
          );
          inFlight.set(dialAttemptId, operation);
        }
        await operation;
        res.status(200).json({ ok: true });
      } catch (err) {
        logger.error({ err, dialAttemptId }, "Ingestión de grabación falló");
        res.status(502).json({ error: "No se pudo almacenar la grabación" });
      }
    }
  );
}

async function processIngest(
  grant: RecordingIngestGrant,
  body: Buffer,
  durationSeconds: number,
  config: { bucket: string; retryAttempts: number; retryBaseMs: number }
): Promise<void> {
  const metadata: RecordingMetadata = {
    sizeBytes: body.length,
    sha256: sha256(body),
    durationSeconds,
  };
  // La duración del propio archivo es la autoridad del tramo grabado y evita
  // depender de que el Hangup ya haya sido persistido cuando llega el POST.
  grant.job.endedAt = new Date(
    new Date(grant.job.startedAt).getTime() + durationSeconds * 1000
  ).toISOString();
  try {
    await persistRecordingState({ job: grant.job, bucket: config.bucket, status: "uploading", metadata });
    await retry(
      () => uploadRecordingIdempotently({ bucket: config.bucket, job: grant.job, metadata, body }),
      config.retryAttempts,
      config.retryBaseMs
    );
    await markRecordingIngested(grant.job.dialAttemptId);
    await retry(
      () => persistRecordingState({ job: grant.job, bucket: config.bucket, status: "ready", metadata }),
      config.retryAttempts,
      config.retryBaseMs
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message.slice(0, 1_000) : String(err).slice(0, 1_000);
    await persistRecordingState({
      job: grant.job,
      bucket: config.bucket,
      status: "failed",
      metadata,
      errorMessage,
    }).catch(() => undefined);
    throw err;
  }
}
