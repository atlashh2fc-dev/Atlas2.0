"use client";

import { createContext, useCallback, useContext, useMemo, useState, type CSSProperties, type ReactNode } from "react";
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

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; iconClass: string }> = {
  success: { icon: CheckCircle2, iconClass: "text-success" },
  danger: { icon: AlertTriangle, iconClass: "text-danger" },
  info: { icon: Info, iconClass: "text-primary" },
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
      {/* Pila abajo a la derecha, como Sonner: la más nueva adelante y las
          anteriores asomando detrás; al pasar el mouse se despliegan. Abajo al
          centro chocaba con la barra de acciones masivas. */}
      <div
        aria-live="polite"
        className="group/toasts pointer-events-none fixed bottom-5 right-5 z-[100] flex w-[min(24rem,calc(100vw-2.5rem))] flex-col-reverse"
      >
        {[...items].reverse().map((t, index) => {
          const { icon: Icon, iconClass } = TONE_STYLES[t.tone];
          const depth = Math.min(index, 3);
          return (
            <div
              key={t.id}
              role="status"
              style={{ "--depth": depth, zIndex: 10 - depth } as CSSProperties}
              className={cn(
                "toast-in pointer-events-auto relative flex items-start gap-3 rounded-xl border border-border-strong bg-surface-solid p-3.5 shadow-xl transition-all duration-300 ease-out",
                index === 0 ? "" : "-mt-[3.4rem] group-hover/toasts:mt-2",
                index > 0 && "origin-bottom scale-[calc(1-var(--depth)*0.05)] opacity-90 group-hover/toasts:scale-100 group-hover/toasts:opacity-100",
                index > 2 && "opacity-0 group-hover/toasts:opacity-100"
              )}
            >
              <span className={cn("mt-px flex size-6 flex-shrink-0 items-center justify-center rounded-full", iconClass)} style={{ background: "color-mix(in srgb, currentColor 14%, transparent)" }}>
                <Icon size={14} aria-hidden="true" />
              </span>
              <p className="flex-1 pt-0.5 text-[13px] leading-snug text-foreground">{t.message}</p>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Cerrar aviso"
                className="flex size-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
