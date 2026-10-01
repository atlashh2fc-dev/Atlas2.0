import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Align = "left" | "right";

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return <table className={cn("w-full border-collapse text-sm tabular-nums", className)}>{children}</table>;
}

/**
 * Cabecera de tabla: sticky, en gris y en caja normal. Sin franja tintada ni
 * versalitas: eso es lo que hacía que cada lista pareciera una planilla.
 */
export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10">
      <tr className="border-b border-border bg-surface text-left text-xs text-muted-foreground">
        {children}
      </tr>
    </thead>
  );
}

export function Th({
  align = "left",
  className,
  children,
}: {
  align?: Align;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <th className={cn("h-10 px-4 font-medium", align === "right" && "text-right", className)}>
      {children}
    </th>
  );
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border/70">{children}</tbody>;
}

export function Tr({ className, children }: { className?: string; children: ReactNode }) {
  return <tr className={cn("transition-colors hover:bg-surface-muted/60", className)}>{children}</tr>;
}

export function Td({
  align = "left",
  muted,
  strong,
  className,
  colSpan,
  children,
}: {
  align?: Align;
  muted?: boolean;
  strong?: boolean;
  className?: string;
  colSpan?: number;
  children?: ReactNode;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "px-4 py-3",
        align === "right" && "text-right",
        muted && "text-muted-foreground",
        strong && "font-medium text-foreground",
        className
      )}
    >
      {children}
    </td>
  );
}

/** Fila de estado vacío que ocupa toda la tabla. */
export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 py-10 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
