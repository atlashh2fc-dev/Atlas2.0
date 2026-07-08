"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./toast";

/**
 * Formulario que invoca un server action y muestra un toast según el resultado.
 * No cambia la firma de los actions existentes (siguen siendo `(FormData) => void`):
 * si el action lanza, se muestra el error; si resuelve, el mensaje de éxito.
 */
export function ActionForm({
  action,
  success,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void> | void;
  success: string;
  className?: string;
  children: ReactNode;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await action(formData);
        toast({ tone: "success", message: success });
        router.refresh();
      } catch (error) {
        toast({
          tone: "danger",
          message: error instanceof Error ? error.message : "Ocurrió un error. Intenta de nuevo.",
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className={className} aria-busy={pending}>
      {children}
    </form>
  );
}
