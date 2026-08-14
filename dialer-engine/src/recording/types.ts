export type RecordingJob = {
  version: 1;
  dialAttemptId: string;
  callId: string;
  leadId: string;
  campaignId: string;
  agentId: string;
  channel: string;
  startedAt: string;
  endedAt: string | null;
  wavPath: string;
  opusPath: string;
  storagePath: string;
};

export type RecordingMetadata = {
  durationSeconds: number;
  sizeBytes: number;
  sha256: string;
};

export type RecordingContext = {
  callId: string;
  leadId: string;
  campaignId: string;
  agentId: string;
  startedAt: string;
  endedAt: string | null;
};

export type RecordingDisconnectParty = "caller" | "agent" | "transfer";

export type RecordingCoordinator = {
  start(params: {
    dialAttemptId: string;
    callId: string;
    agentId: string;
    campaignId?: string | null;
    channel: string;
  }): Promise<void>;
  stop(
    dialAttemptId: string,
    completion?: { disconnectParty: RecordingDisconnectParty | null; queueTalkSeconds: number | null }
  ): Promise<void>;
};

export type RecordingIngestGrant = {
  job: RecordingJob;
  tokenHash: string;
  expiresAt: string;
  ingestedAt: string | null;
  status: string;
};
