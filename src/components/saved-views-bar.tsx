"use client";

import { useEffect, useState } from "react";
import { BookmarkPlus, Check, Trash2 } from "lucide-react";
import {
  deleteMySavedView,
  listMySavedViews,
  saveMyNamedView,
  type SavedView,
  type ViewKey,
} from "@/app/actions/view-preferences";
import { Button, Input, useToast } from "@/components/ui";

/**
 * Vistas con nombre de una pantalla.
 *
 * Un supervisor no mira el monitor de una sola forma: quiere una vista por
 * campaña, otra para el arranque del turno, otra para vigilar abandono. Se
 * guardan en la cuenta —no en el navegador— para encontrarlas desde cualquier
 * equipo.
 */
export function SavedViewsBar<T>({
  viewKey,
  currentConfig,
  onApply,
}: {
  viewKey: ViewKey;
  /** Se lee al guardar: es la foto de lo que hay en pantalla ahora. */
  currentConfig: T;
  onApply: (config: T) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let disposed = false;
    listMySavedViews(viewKey)
      .then((saved) => {
        if (!disposed) queueMicrotask(() => setViews(saved));
      })
      .catch(() => {
        /* la pantalla funciona igual sin vistas guardadas */
      });
    return () => {
      disposed = true;
    };
  }, [viewKey]);

  const save = async () => {
    setPending(true);
    const result = await saveMyNamedView(viewKey, name, currentConfig);
    setPending(false);

    if (!result.ok) {
      toast({ tone: "danger", message: result.error });
      return;
    }

    // Un nombre repetido sobrescribe: se reemplaza en la lista en vez de
    // duplicarlo.
    setViews((current) => {
      const rest = current.filter((view) => view.id !== result.view.id);
      return [...rest, result.view].sort((a, b) => a.name.localeCompare(b.name, "es"));
    });
    setAppliedId(result.view.id);
    setName("");
    setNaming(false);
    toast({ tone: "success", message: `Vista "${result.view.name}" guardada` });
  };

  const remove = async (view: SavedView) => {
    try {
      await deleteMySavedView(view.id);
      setViews((current) => current.filter((item) => item.id !== view.id));
      if (appliedId === view.id) setAppliedId(null);
      toast({ tone: "success", message: `Vista "${view.name}" eliminada` });
    } catch (error) {
      toast({
        tone: "danger",
        message: error instanceof Error ? error.message : "No se pudo eliminar la vista.",
      });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {views.map((view) => {
        const active = view.id === appliedId;
        return (
          <span
            key={view.id}
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition ${
              active
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            <button
              type="button"
              onClick={() => {
                onApply(view.config as T);
                setAppliedId(view.id);
              }}
              title={`Aplicar la vista ${view.name}`}
              className="inline-flex items-center gap-1"
            >
              {active && <Check size={12} aria-hidden="true" />}
              {view.name}
            </button>
            <button
              type="button"
              onClick={() => void remove(view)}
              title={`Eliminar la vista ${view.name}`}
              aria-label={`Eliminar la vista ${view.name}`}
              className="rounded p-0.5 hover:text-danger"
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </span>
        );
      })}

      {naming ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Input
            fieldSize="sm"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej. Secretaría Virtual"
            aria-label="Nombre de la vista"
            className="w-48"
            data-autofocus
            autoFocus
          />
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            {pending ? "Guardando…" : "Guardar"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setNaming(false);
              setName("");
            }}
          >
            Cancelar
          </Button>
        </form>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setNaming(true)} title="Guardar la vista actual con un nombre">
          <BookmarkPlus size={14} aria-hidden="true" />
          Guardar vista
        </Button>
      )}
    </div>
  );
}
