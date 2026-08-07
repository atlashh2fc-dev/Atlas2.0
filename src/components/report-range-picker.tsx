"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import {
  REPORT_PRESETS,
  REPORT_PRESET_LABELS,
  reportRangeSearchParams,
  resolveReportRange,
  toDateInput,
  type ReportPreset,
  type ReportRange,
} from "@/lib/report-range";

/**
 * Selector de período de los reportes.
 *
 * Escribe en la URL (`?preset=` o `?from=&to=`) en vez de guardar estado
 * propio: así el rango sobrevive al cambio de pestaña Gestión/Discador, se
 * puede compartir el enlace y los server components lo leen sin prop drilling.
 * Conserva el resto de la query —la campaña seleccionada, sobre todo—.
 */
export function ReportRangePicker() {
  const searchParams = useSearchParams();

  const range = resolveReportRange({
    preset: searchParams.get("preset") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  // La URL manda. Al navegar atrás o entrar por un enlace compartido, la `key`
  // remonta los controles con el período aplicado, en vez de sincronizar el
  // estado con un efecto (que dispara renders en cascada).
  return (
    <RangeControls
      key={`${range.preset}:${toDateInput(range.from)}:${toDateInput(range.to)}`}
      range={range}
    />
  );
}

function RangeControls({ range }: { range: ReportRange }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [preset, setPreset] = useState<ReportPreset>(range.preset);
  const [from, setFrom] = useState(() => toDateInput(range.from));
  const [to, setTo] = useState(() => toDateInput(range.to));

  const apply = (next: { preset: ReportPreset; from: string; to: string }) => {
    const resolved = resolveReportRange({
      preset: next.preset,
      from: next.from,
      to: next.to,
    });
    const params = reportRangeSearchParams(resolved, new URLSearchParams(searchParams.toString()));
    router.push(`${pathname}?${params.toString()}`);
  };

  const onPresetChange = (value: string) => {
    const nextPreset = (REPORT_PRESETS as readonly string[]).includes(value)
      ? (value as ReportPreset)
      : "30d";
    setPreset(nextPreset);
    // El personalizado espera a que el usuario confirme sus fechas; el resto se
    // aplica al instante, que es lo que uno espera de un atajo.
    if (nextPreset !== "custom") apply({ preset: nextPreset, from, to });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CalendarRange size={15} />
        Período
      </span>

      <Select
        fieldSize="sm"
        value={preset}
        onChange={(event) => onPresetChange(event.target.value)}
        aria-label="Período analizado"
        className="w-auto"
      >
        {REPORT_PRESETS.map((option) => (
          <option key={option} value={option}>
            {REPORT_PRESET_LABELS[option]}
          </option>
        ))}
      </Select>

      {preset === "custom" && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ preset: "custom", from, to });
          }}
        >
          <Input
            type="date"
            fieldSize="sm"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="Desde"
            className="w-auto"
          />
          <span className="text-xs text-muted-foreground">a</span>
          <Input
            type="date"
            fieldSize="sm"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            aria-label="Hasta"
            className="w-auto"
          />
          <Button type="submit" size="sm">
            Aplicar
          </Button>
        </form>
      )}
    </div>
  );
}
