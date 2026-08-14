export class AttemptEventLifecycle {
  private readonly terminalHangups = new Set<string>();
  private readonly agentCompletes = new Set<string>();

  registerHangup(dialAttemptId: string, bridged: boolean): { duplicate: boolean; cleanup: boolean } {
    if (this.terminalHangups.has(dialAttemptId)) return { duplicate: true, cleanup: false };
    this.terminalHangups.add(dialAttemptId);
    return { duplicate: false, cleanup: !bridged || this.agentCompletes.has(dialAttemptId) };
  }

  registerAgentComplete(dialAttemptId: string): { cleanup: boolean } {
    this.agentCompletes.add(dialAttemptId);
    return { cleanup: this.terminalHangups.has(dialAttemptId) };
  }

  clear(dialAttemptId: string): void {
    this.terminalHangups.delete(dialAttemptId);
    this.agentCompletes.delete(dialAttemptId);
  }
}
