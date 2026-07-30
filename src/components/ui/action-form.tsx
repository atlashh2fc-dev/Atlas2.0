"use client";

import { createContext, useContext, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { useToast } from "./toast";

const PendingContext = createContext(false);

/**
 * Next señaliza redirect() y notFound() lanzando un error con un `digest`
 * reservado. No son fallos y hay que dejarlos pasar.
 */
function isNextControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

/** `true` mientras el ActionForm que envuelve al componente está en vuelo. */
export function useActionPending(): boolean {
  return useContext(PendingContext);
}

/**
 * Formulario que invoca un server action y muestra un toast según el resultado.
 * No cambia la firma de los actions existentes (siguen siendo `(FormData) => void`):
 * si el action lanza, se muestra el error; si resuelve, el mensaje de éxito.
 *
 * Un `<form action={serverAction}>` crudo no hace ninguna de las dos cosas: un
 * throw se convierte en la página genérica "a server error occurred" y el
 * usuario nunca ve el motivo. Peor todavía, nada impide enviarlo dos veces —
 * fue lo que pasó al crear un usuario el 2026-07-30: el primer envío creó la
 * cuenta y el segundo murió con 500 en la validación de correo duplicado, así
 * que la pantalla mostró un error sobre una operación que sí había funcionado.
 */
export function ActionForm({
  action,
  success,
  className,
  onSuccess,
  children,
}: {
  action: (formData: FormData) => Promise<void> | void;
  success: string;
  className?: string;
  /** Se ejecuta solo si el action resolvió; sirve para cerrar el panel. */
  onSuccess?: () => void;
  children: ReactNode;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Segundo candado, además del botón deshabilitado: un Enter repetido o un
    // doble clic rápido puede disparar submit antes de que React repinte.
    if (pending) return;

    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      try {
        await action(formData);
        toast({ tone: "success", message: success });
        onSuccess?.();
        router.refresh();
      } catch (error) {
        // `redirect()` y `notFound()` de Next señalizan lanzando: si los
        // tratáramos como fallo, la navegación no ocurriría y el usuario vería
        // un toast de error sobre una operación que funcionó.
        if (isNextControlFlow(error)) throw error;

        toast({
          tone: "danger",
          message: error instanceof Error ? error.message : "Ocurrió un error. Intenta de nuevo.",
        });
      }
    });
  }

  return (
    <PendingContext.Provider value={pending}>
      <form onSubmit={onSubmit} className={className} aria-busy={pending}>
        {children}
      </form>
    </PendingContext.Provider>
  );
}

/**
 * Botón de envío de un ActionForm: se deshabilita solo mientras corre el action.
 * Para los `<form action={...}>` que viven en server components usa SubmitButton,
 * que hace lo mismo apoyándose en useFormStatus.
 */
export function ActionSubmit({
  children,
  pendingLabel,
  ...props
}: Omit<ButtonProps, "type"> & { pendingLabel?: string }) {
  const pending = useActionPending();

  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {pending ? pendingLabel ?? children : children}
    </Button>
  );
}
