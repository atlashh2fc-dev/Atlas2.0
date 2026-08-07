"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  getMyViewPreference,
  saveMyViewPreference,
  type ViewKey,
} from "@/app/actions/view-preferences";
import { usePersistentState } from "@/lib/persistent-state";

/**
 * Preferencia de vista guardada en la cuenta, con `localStorage` como caché.
 *
 * El orden importa: primero se pinta con lo que hay en el navegador —para que
 * la pantalla no salte al cargar— y en cuanto responde el servidor manda su
 * versión, que es la que sigue a la persona entre equipos. Los cambios se
 * escriben con retardo: arrastrar una tarjeta emite decenas de eventos y no
 * corresponde una escritura por cada uno.
 */
const SAVE_DEBOUNCE_MS = 800;

export function useViewPreference<T>(
  viewKey: ViewKey,
  fallback: T
): [T, (next: T) => void] {
  const [value, setValue] = usePersistentState<T>(`atlas:view:${viewKey}`, fallback);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Evita que la respuesta del servidor pise un cambio que el usuario acaba de
  // hacer mientras la petición viajaba.
  const dirtyRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    getMyViewPreference<T>(viewKey)
      .then((remote) => {
        if (disposed || remote === null || dirtyRef.current) return;
        queueMicrotask(() => {
          if (!disposed) setValue(remote);
        });
      })
      .catch((error) => {
        console.error("[useViewPreference] no se pudo leer la preferencia", error);
      });
    return () => {
      disposed = true;
    };
  }, [viewKey, setValue]);

  const update = useCallback(
    (next: T) => {
      dirtyRef.current = true;
      setValue(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveMyViewPreference(viewKey, next);
      }, SAVE_DEBOUNCE_MS);
    },
    [viewKey, setValue]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return [value, update];
}
