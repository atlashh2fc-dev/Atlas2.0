"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";

/**
 * Botón de envío que se deshabilita solo mientras el formulario está en vuelo.
 *
 * Existe para los `<form action={serverAction}>` que viven dentro de server
 * components y por eso no pueden usar ActionForm: `useFormStatus` funciona
 * desde un hijo cliente sin obligar a convertir la página entera. Evita el
 * doble envío, que es lo que rompió la creación de usuarios el 2026-07-30.
 */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: Omit<ButtonProps, "type"> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {pending ? pendingLabel ?? children : children}
    </Button>
  );
}
