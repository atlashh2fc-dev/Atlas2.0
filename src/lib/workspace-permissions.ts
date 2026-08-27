import type { AppRole, Profile } from "./types";

/** Capabilities describe a workspace, not a hierarchy of increasingly powerful agents. */
export function getWorkspacePermissions(role: AppRole) {
  return {
    canAttendCustomers: role === "agente",
    canReadConversationContent: role === "agente" || role === "supervisor",
    canManageAssignments: role === "admin" || role === "supervisor",
    canMonitorOperations: role === "admin" || role === "supervisor",
    canConfigurePlatform: role === "admin",
    canReviewQuality: role === "admin" || role === "supervisor",
    workspaceLabel: role === "admin"
      ? "Control"
      : role === "supervisor"
        ? "Supervisión"
        : "Atención",
  };
}

/** Reading an interaction never grants permission to act on the customer's behalf. */
export function canOperateAssignedConversation(
  profile: Pick<Profile, "id" | "role" | "active">,
  assignedTo: string | null,
) {
  return profile.active
    && getWorkspacePermissions(profile.role).canAttendCustomers
    && assignedTo !== null
    && assignedTo === profile.id;
}

export function assertCanOperateAssignedConversation(
  profile: Pick<Profile, "id" | "role" | "active">,
  assignedTo: string | null,
) {
  if (!canOperateAssignedConversation(profile, assignedTo)) {
    throw new Error("Solo el ejecutivo asignado puede atender esta conversación.");
  }
}
