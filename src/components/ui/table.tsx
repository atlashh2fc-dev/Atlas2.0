import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Align = "left" | "right";

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return <table className={cn("w-full text-sm", className)}>{children}</table>;
}

/** Cabecera de tabla. Pásale celdas `<Th>` como children. */
export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border text-left text-xs text-muted-foreground">{children}</tr>
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
    <th className={cn("px-5 py-3 font-medium", align === "right" && "text-right", className)}>{children}</th>
  );
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function Tr({ className, children }: { className?: string; children: ReactNode }) {
  return <tr className={className}>{children}</tr>;
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
        "px-5 py-3",
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
      <td colSpan={colSpan} className="px-5 py-6 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
