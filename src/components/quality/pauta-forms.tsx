"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Upload } from "lucide-react";
import { updatePautaSettings, uploadPauta } from "@/app/actions/calidad";
import { Button, Callout, Input, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";

export function PautaSettingsForm({
  pautaId,
  campaigns,
  initial,
}: {
  pautaId: string;
  campaigns: { id: string; name: string }[];
  initial: { campaignIds: string[]; objective: number; minSeconds: number; dailySamplePerAgent: number };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(() => new Set(initial.campaignIds));
  const [objective, setObjective] = useState(String(initial.objective));
  const [minSeconds, setMinSeconds] = useState(String(initial.minSeconds));
  const [sample, setSample] = useState(String(initial.dailySamplePerAgent));
  const [error, setError] = useState<string | null>(null);

  const toNumber = (value: string) => Number(value.replace(",", "."));
  const objectiveValid = Number.isFinite(toNumber(objective)) && toNumber(objective) >= 0 && toNumber(objective) <= 100;
  const sampleValid = Number.isInteger(toNumber(sample)) && toNumber(sample) >= 0 && toNumber(sample) <= 50;
  const minValid = Number.isInteger(toNumber(minSeconds)) && toNumber(minSeconds) >= 0 && toNumber(minSeconds) <= 3600;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updatePautaSettings({
        pautaId,
        campaignIds: [...selected],
        objective: toNumber(objective),
        minSeconds: toNumber(minSeconds),
        dailySamplePerAgent: toNumber(sample),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ tone: "success", message: result.message });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-[13px] font-medium text-foreground">Campañas que se evalúan con esta pauta</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {campaigns.map((campaign) => {
            const checked = selected.has(campaign.id);
            return (
              <label
                key={campaign.id}
                className={cn(
                  "flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs transition-colors",
                  checked ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:border-primary/50",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (next.has(campaign.id)) next.delete(campaign.id);
                      else next.add(campaign.id);
                      return next;
                    })
                  }
                />
                {campaign.name}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-foreground">Nota objetivo</span>
          <Input inputMode="decimal" value={objective} onChange={(event) => setObjective(event.target.value)} aria-invalid={!objectiveValid} />
          {!objectiveValid && <span className="text-xs text-danger">Entre 0 y 100.</span>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-foreground">Muestra diaria por ejecutivo</span>
          <Input inputMode="numeric" value={sample} onChange={(event) => setSample(event.target.value)} aria-invalid={!sampleValid} />
          <span className={cn("text-xs", sampleValid ? "text-muted-foreground" : "text-danger")}>
            {sampleValid ? (toNumber(sample) === 0 ? "Solo se evalúa a pedido." : "Atlas las transcribe y evalúa solo.") : "Entre 0 y 50."}
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-foreground">Duración mínima (segundos)</span>
          <Input inputMode="numeric" value={minSeconds} onChange={(event) => setMinSeconds(event.target.value)} aria-invalid={!minValid} />
          {!minValid && <span className="text-xs text-danger">Entre 0 y 3.600.</span>}
        </label>
      </div>

      {error && <Callout tone="danger">{error}</Callout>}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={save} disabled={pending || !objectiveValid || !sampleValid || !minValid}>
          {pending && <LoaderCircle size={15} className="animate-spin" />}
          Guardar configuración
        </Button>
      </div>
    </div>
  );
}

export function PautaUploadForm({ pautaKey, pautaName }: { pautaKey: string | null; pautaName: string | null }) {
  const router = useRouter();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "success" | "danger"; message: string; warnings: string[] } | null>(null);

  const submit = (formData: FormData) => {
    setResult(null);
    startTransition(async () => {
      const response = await uploadPauta(formData);
      if (!response.ok) {
        setResult({ tone: "danger", message: response.error, warnings: [] });
        return;
      }
      setResult({ tone: "success", message: response.message, warnings: response.warnings });
      toast({ tone: "success", message: response.message });
      formRef.current?.reset();
      setFileName(null);
      router.refresh();
    });
  };

  return (
    <form ref={formRef} action={submit} className="space-y-3">
      {pautaKey && <input type="hidden" name="pauta_key" value={pautaKey} />}
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-foreground">Nombre</span>
        <Input name="name" defaultValue={pautaName ?? ""} placeholder="Pauta de calidad Equifax" maxLength={120} />
      </label>
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
          fileName ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        )}
      >
        <Upload size={18} className="text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-medium text-foreground">{fileName ?? "Elige la planilla de la pauta"}</span>
        <span className="text-xs text-muted-foreground">Excel con bloques «RUBRICA- NOMBRE» y columnas Atributo, Peso y Definición</span>
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls"
          className="sr-only"
          required
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
        />
      </label>
      {result && (
        <Callout tone={result.tone}>
          {result.message}
          {result.warnings.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-xs">
              {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </Callout>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !fileName}>
          {pending ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />}
          {pautaKey ? "Subir nueva versión" : "Cargar pauta"}
        </Button>
      </div>
    </form>
  );
}
