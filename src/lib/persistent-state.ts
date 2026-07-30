"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * Estado persistido en `localStorage` y compartido entre componentes.
 *
 * Se usa `useSyncExternalStore` en vez de `useEffect` + `setState` para que no
 * haya cascada de renders ni desajuste de hidratación: durante el render del
 * servidor y la hidratación se devuelve el valor por defecto, y React vuelve a
 * renderizar con el valor guardado en cuanto el cliente toma el control.
 *
 * El `fallback` se captura en el primer render, así que puede ser un literal.
 */

const listeners = new Map<string, Set<() => void>>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function subscribe(key: string, onChange: () => void) {
  const set = listeners.get(key) ?? new Set();
  set.add(onChange);
  listeners.set(key, set);
  return () => {
    set.delete(onChange);
  };
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const cached = cache.get(key);
    if (cached && cached.raw === raw) return cached.value as T;
    const value = JSON.parse(raw) as T;
    cache.set(key, { raw, value });
    return value;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  try {
    const raw = JSON.stringify(value);
    window.localStorage.setItem(key, raw);
    cache.set(key, { raw, value });
  } catch {
    /* la preferencia es opcional: nunca bloquear la interacción */
  }
  listeners.get(key)?.forEach((listener) => listener());
}

export function usePersistentState<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const fallbackRef = useRef(fallback);

  const value = useSyncExternalStore(
    useCallback((onChange: () => void) => subscribe(key, onChange), [key]),
    useCallback(() => read(key, fallbackRef.current), [key]),
    useCallback(() => fallbackRef.current, [])
  );

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const previous = read(key, fallbackRef.current);
      write(key, typeof next === "function" ? (next as (prev: T) => T)(previous) : next);
    },
    [key]
  );

  return [value, setValue];
}
