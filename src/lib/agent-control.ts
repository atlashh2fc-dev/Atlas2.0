export const AGENT_FORCE_LOGOUT_EVENT = "atlas:agent-force-logout";

export type AgentForceLogoutEventDetail = {
  commandId: string;
  shutdowns: Promise<unknown>[];
};

