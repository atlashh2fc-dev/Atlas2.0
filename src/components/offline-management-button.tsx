"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { beginOfflineManagement, type OfflineManagementChannel } from "@/app/actions/calls";

const CHANNELS: { value: OfflineManagementChannel; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "correo", label: "Correo" },
  { value: "presencial", label: "Presencial" },
  { value: "otro", label: "Otro" },
];

/**
 * Tipificar sin llamar: el cliente respondió por WhatsApp (que aún no está en
 * Atlas), por correo o en persona. Abre la misma tipificación de siempre sobre
 * una gestión marcada con su canal.
 */
export function OfflineManagementButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<OfflineManagementChannel>("whatsapp");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setError(null);
    startTransition(async () => {
      const result = await beginOfflineManagement(leadId, channel);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
      for (const delay of [300, 900, 1800]) {
        window.setTimeout(() => {
          document.getElementById("gestion-en-curso")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, delay);
      }
    });
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={buttonClasses({ size: "sm", variant: "secondary" })}
      >
        <MessageSquare size={14} />
        Registrar gestión sin llamada
      </button>
      {open && (
        <span className="absolute right-0 top-full z-30 mt-1 block w-72 space-y-2 rounded-xl border border-border bg-surface p-3 text-left shadow-lg">
          <span className="block text-xs font-semibold text-foreground">¿Por dónde fue el contacto?</span>
          <span className="flex flex-wrap gap-1.5">
            {CHANNELS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={channel === option.value}
                onClick={() => setChannel(option.value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  channel === option.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-primary/50"
                }`}
              >
                {option.label}
              </button>
            ))}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            Se abre la tipificación de este registro sin llamar. Queda a tu nombre con el canal elegido.
          </span>
          {error && <span role="alert" className="block text-xs text-danger">{error}</span>}
          <button
            type="button"
            disabled={pending}
            onClick={start}
            className={buttonClasses({ size: "sm" })}
          >
            {pending ? "Abriendo…" : "Tipificar ahora"}
          </button>
        </span>
      )}
    </span>
  );
}
