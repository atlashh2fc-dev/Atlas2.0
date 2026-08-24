export type OperationalCheckName =
  | "agentDirectory"
  | "agentConfigSync"
  | "campaignLoop"
  | "aiVoiceCampaignLoop"
  | "agentPauseSync"
  | "agentHeartbeat"
  | "agentControl"
  | "healthPublish";

type CheckState = {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  failureCode: string | null;
};

type CheckSnapshot = {
  status: "ok" | "failed" | "stale" | "starting";
  last_attempt_at: string | null;
  last_success_at: string | null;
  consecutive_failures: number;
  failure_code: string | null;
};

const newCheckState = (): CheckState => ({
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  consecutiveFailures: 0,
  failureCode: null,
});

/**
 * Estado operacional en memoria. Nunca almacena mensajes de excepción porque
 * las acciones AMI pueden contener secretos SIP; sólo conserva códigos
 * controlados por el proceso.
 */
export class OperationalHealthTracker {
  private readonly startedAt: number;
  private readonly checks = new Map<OperationalCheckName, CheckState>();

  constructor(startedAt = Date.now()) {
    this.startedAt = startedAt;
  }

  success(name: OperationalCheckName, at = Date.now()): void {
    const state = this.checks.get(name) ?? newCheckState();
    state.lastAttemptAt = at;
    state.lastSuccessAt = at;
    state.consecutiveFailures = 0;
    state.failureCode = null;
    this.checks.set(name, state);
  }

  failure(name: OperationalCheckName, failureCode: string, at = Date.now()): void {
    const state = this.checks.get(name) ?? newCheckState();
    state.lastAttemptAt = at;
    state.lastFailureAt = at;
    state.consecutiveFailures += 1;
    state.failureCode = failureCode;
    this.checks.set(name, state);
  }

  snapshot(input: {
    amiConnected: boolean;
    campaignCount: number;
    recordingEnabled: boolean;
    release: string;
    tickMs: number;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const startupGraceMs = 60_000;
    const staleAfter: Partial<Record<OperationalCheckName, number>> = {
      agentDirectory: 45_000,
      agentConfigSync: 45_000,
      campaignLoop: Math.max(30_000, input.tickMs * 10),
      aiVoiceCampaignLoop: Math.max(30_000, input.tickMs * 10),
      agentPauseSync: 45_000,
      agentHeartbeat: 120_000,
      agentControl: 60_000,
      healthPublish: 60_000,
    };
    const critical: OperationalCheckName[] = ["agentDirectory", "agentConfigSync", "campaignLoop", "aiVoiceCampaignLoop"];
    const checkSnapshots = {} as Record<OperationalCheckName, CheckSnapshot>;

    for (const name of Object.keys(staleAfter) as OperationalCheckName[]) {
      const state = this.checks.get(name) ?? newCheckState();
      let status: CheckSnapshot["status"] = "ok";
      if (state.lastAttemptAt === null) {
        status = now - this.startedAt <= startupGraceMs ? "starting" : "stale";
      } else if (
        state.lastFailureAt !== null
        && state.lastFailureAt > (state.lastSuccessAt ?? Number.NEGATIVE_INFINITY)
      ) {
        status = "failed";
      } else if (now - state.lastAttemptAt > (staleAfter[name] ?? 60_000)) {
        status = "stale";
      }
      checkSnapshots[name] = {
        status,
        last_attempt_at: state.lastAttemptAt === null ? null : new Date(state.lastAttemptAt).toISOString(),
        last_success_at: state.lastSuccessAt === null ? null : new Date(state.lastSuccessAt).toISOString(),
        consecutive_failures: state.consecutiveFailures,
        failure_code: state.failureCode,
      };
    }

    const criticalHealthy = critical.every((name) => {
      const status = checkSnapshots[name].status;
      return status === "ok" || status === "starting";
    });
    const ok = input.amiConnected && criticalHealthy;
    const status: "ready" | "degraded" = ok ? "ready" : "degraded";
    const ami: "connected" | "disconnected" = input.amiConnected ? "connected" : "disconnected";

    return {
      ok,
      status,
      release: input.release,
      node: process.version,
      uptime_seconds: Math.floor((now - this.startedAt) / 1000),
      ami,
      campaigns: input.campaignCount,
      recording: input.recordingEnabled ? "enabled" : "disabled",
      checks: checkSnapshots,
    };
  }
}
