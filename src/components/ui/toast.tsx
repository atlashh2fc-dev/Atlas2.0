"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastTone = "success" | "danger" | "info";

type ToastItem = { id: number; tone: ToastTone; message: string };

type ToastContextValue = {
  toast: (input: { tone?: ToastTone; message: string }) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** Hook para disparar toasts desde cualquier client component bajo el provider. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return ctx;
}

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; className: string; iconClass: string }> = {
  success: { icon: CheckCircle2, className: "border-success/30", iconClass: "text-success" },
  danger: { icon: AlertTriangle, className: "border-danger/30", iconClass: "text-danger" },
  info: { icon: Info, className: "border-border", iconClass: "text-primary" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ tone = "info", message }: { tone?: ToastTone; message: string }) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, tone, message }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
        {items.map((t) => {
          const { icon: Icon, className, iconClass } = TONE_STYLES[t.tone];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface p-3 shadow-md",
                className
              )}
            >
              <Icon size={17} className={cn("mt-0.5 flex-shrink-0", iconClass)} />
              <p className="flex-1 text-sm text-foreground">{t.message}</p>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Cerrar"
                className="flex-shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
