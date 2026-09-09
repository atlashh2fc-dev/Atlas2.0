"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Eye } from "lucide-react";
import { switchDemoAccount } from "@/app/actions/demo";
import { demoAccountLabel, type DemoViewAccount } from "@/lib/demo-view";

/**
 * Selector de vista de las cuentas de demostración.
 *
 * Vive en el encabezado, junto al selector de campaña, porque en una demo se
 * usa igual de seguido: se muestra la gestión desde el puesto del ejecutivo y
 * se salta al tablero del supervisor sin cerrar sesión.
 *
 * Esconder el control no es la protección: el servidor vuelve a comprobar que
 * quien pide el cambio y la cuenta de destino sean de demostración.
 */
export function DemoRoleSwitcher({
  accounts,
  currentId,
}: {
  accounts: DemoViewAccount[];
  currentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (accounts.length < 2) return null;

  function change(nextId: string) {
    if (nextId === currentId) return;
    startTransition(async () => {
      await switchDemoAccount(nextId);
      // La sesión cambió de persona: sin refresh la pantalla seguiría
      // mostrando el menú y los datos de la vista anterior.
      router.refresh();
    });
  }

  return (
    <label
      className={`flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.04] px-2.5 py-1.5 text-xs text-muted-foreground ${
        pending ? "opacity-60" : ""
      }`}
      title="Vista de demostración"
    >
      <Eye size={14} aria-hidden="true" />
      <span className="hidden sm:inline">Ver como</span>
      <select
        aria-label="Vista de demostración"
        value={currentId}
        disabled={pending}
        onChange={(event) => change(event.target.value)}
        className="max-w-44 bg-transparent font-medium text-foreground outline-none"
      >
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {demoAccountLabel(account)}
          </option>
        ))}
      </select>
    </label>
  );
}
