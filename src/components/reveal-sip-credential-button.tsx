"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { revealAgentSipCredential } from "@/app/actions/agent-sip";

export function RevealSipCredentialButton({ profileId }: { profileId: string }) {
  const [credential, setCredential] = useState<{ extension: string; sip_password: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (credential) {
      setCredential(null);
      return;
    }
    setLoading(true);
    try {
      const result = await revealAgentSipCredential(profileId);
      setCredential(result);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-40"
      >
        {credential ? <EyeOff size={12} /> : <Eye size={12} />}
        {credential ? "Ocultar clave" : "Ver clave"}
      </button>
      {credential && (
        <code className="rounded bg-surface-muted px-2 py-1 text-xs text-foreground">
          {credential.extension} / {credential.sip_password}
        </code>
      )}
    </div>
  );
}
