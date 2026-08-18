"use client";

import { useRef, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { updateUserPassword } from "@/app/actions/admin";
import { ActionForm, ActionSubmit, Button, Input } from "@/components/ui";

const MIN_PASSWORD_LENGTH = 8;

export function UserPasswordDialog({
  user,
}: {
  user: { id: string; fullName: string; email: string };
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmation.length > 0 && password !== confirmation;
  const canSubmit = password.length >= MIN_PASSWORD_LENGTH && password === confirmation;

  function close() {
    dialogRef.current?.close();
    setPassword("");
    setConfirmation("");
    setVisible(false);
  }

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => dialogRef.current?.showModal()}>
        <KeyRound size={13} aria-hidden />
        Cambiar contraseña
      </Button>

      <dialog
        ref={dialogRef}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        className="w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/45"
      >
        <div className="border-b border-border px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Acceso del usuario</p>
          <h2 className="mt-1 text-lg font-semibold">Cambiar contraseña</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {user.fullName} · {user.email}
          </p>
        </div>

        <ActionForm
          action={updateUserPassword}
          success={`Contraseña de ${user.fullName} actualizada`}
          onSuccess={close}
          className="space-y-4 p-5"
        >
          <input type="hidden" name="user_id" value={user.id} />

          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Nueva contraseña</span>
            <span className="relative block">
              <Input
                type={visible ? "text" : "password"}
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setVisible((current) => !current)}
                aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={visible}
                className="absolute inset-y-0 right-1 flex w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {visible ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
            <span className={`mt-1 block text-xs ${tooShort ? "text-danger" : "text-muted-foreground"}`}>
              Mínimo {MIN_PASSWORD_LENGTH} caracteres.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Repite la contraseña</span>
            <Input
              type={visible ? "text" : "password"}
              name="password_confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              aria-invalid={mismatch}
            />
            {mismatch && <span className="mt-1 block text-xs text-danger">Las contraseñas no coinciden.</span>}
          </label>

          <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
            La nueva contraseña tendrá efecto inmediato. Compártela con el usuario por un canal seguro.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={close}>
              Cancelar
            </Button>
            <ActionSubmit disabled={!canSubmit} pendingLabel="Guardando…">
              Guardar contraseña
            </ActionSubmit>
          </div>
        </ActionForm>
      </dialog>
    </>
  );
}
