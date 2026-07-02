"use client";

import { FileSpreadsheet } from "lucide-react";

type ExportValue = string | number | null | undefined;

export function ChartDownloadButton({
  rows,
  filename,
}: {
  rows: Record<string, ExportValue>[];
  filename: string;
}) {
  const download = async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{}]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
    XLSX.writeFile(workbook, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
  };

  return (
    <button
      type="button"
      onClick={download}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Descargar ${filename}`}
      title="Descargar data"
    >
      <FileSpreadsheet className="size-3.5" aria-hidden="true" />
      XLSX
    </button>
  );
}
