import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export type AvatarTone =
  | "primary"
  | "blue"
  | "teal"
  | "green"
  | "amber"
  | "violet"
  | "rose"
  | "indigo"
  | "orange"
  | "cyan"
  | "pink"
  | "slate";

/** Tonos que se reparten entre nombres. Sin `slate` (es el de "sin dato"). */
const HUES: AvatarTone[] = ["blue", "violet", "teal", "amber", "rose", "indigo", "green", "orange", "cyan", "pink"];

/** El mismo nombre recibe siempre el mismo tono, en cualquier pantalla. */
export function avatarTone(seed: string | null | undefined): AvatarTone {
  if (!seed) return "slate";
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return HUES[Math.abs(hash) % HUES.length];
}

/**
 * Dos iniciales legibles: "SOC DE MANTENCION S A" → "SM", "Paula Sanhueza" → "PS".
 * Se saltan las palabras de relleno de las razones sociales.
 */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const filler = new Set(["de", "del", "la", "las", "los", "y", "e", "s", "a", "sa", "spa", "ltda", "limitada", "eirl", "cia"]);
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = words.filter((word) => !filler.has(word.toLowerCase()));
  const source = meaningful.length > 0 ? meaningful : words;
  if (source.length === 0) return "?";
  const first = source[0][0] ?? "";
  const second = source.length > 1 ? source[1][0] : source[0][1] ?? "";
  return (first + second).toUpperCase();
}

const SIZES = {
  xs: "size-5 text-[9px]",
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
} as const;

const ICON_SIZES = { xs: 11, sm: 14, md: 17, lg: 20 } as const;

/**
 * Identidad visual de una persona, empresa o archivo: iniciales (o un icono)
 * sobre el tono que le toca a ese nombre. Redondo para personas, cuadrado
 * para cosas (empresas, archivos, buzones).
 */
export function Avatar({
  name,
  seed,
  icon: Icon,
  tone,
  size = "sm",
  shape = "circle",
  className,
}: {
  name?: string | null;
  /** Qué decide el tono; por defecto el nombre. */
  seed?: string | null;
  icon?: ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;
  tone?: AvatarTone;
  size?: keyof typeof SIZES;
  shape?: "circle" | "square";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone ?? avatarTone(seed ?? name)}
      className={cn("avatar", SIZES[size], shape === "circle" ? "rounded-full" : "rounded-lg", className)}
    >
      {Icon ? <Icon size={ICON_SIZES[size]} aria-hidden="true" /> : initials(name)}
    </span>
  );
}
