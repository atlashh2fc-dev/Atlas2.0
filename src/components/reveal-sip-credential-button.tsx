"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { revealAgentSipCredential } from "@/app/actions/agent-sip";
import { Button, actionErrorMessage, useToast } from "@/components/ui";

export function RevealSipCredentialButton({
  profileId,
  disabled = false,
}: {
  profileId: string;
  /** Con la sincronización caída la clave mostrada puede no ser la que tiene Asterisk. */
  disabled?: boolean;
}) {
  const { toast } = useToast();
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
    } catch (error) {
      // Sin esto un fallo dejaba el botón sin respuesta y sin explicación.
      console.error("[agentes-sip] revelar credencial", error);
      toast({ tone: "danger", message: `No se pudo mostrar la clave. ${actionErrorMessage(error)}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={handleClick} disabled={loading || disabled}>
        {credential ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
        {loading ? "Buscando…" : credential ? "Ocultar clave" : "Ver clave"}
      </Button>
      {credential && (
        <code className="rounded-md border border-border bg-surface-muted px-2 py-1 text-xs text-foreground">
          {credential.extension} / {credential.sip_password}
        </code>
      )}
    </div>
  );
}
