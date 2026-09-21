"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Contrast, Download, FileText, ImagePlus, Loader2, RotateCw, Sun, X, ZoomIn, ZoomOut } from "lucide-react";

import { registrarEstudio } from "@/app/actions/estudios";
import { Button, Field, Input, Select, useToast } from "@/components/ui";
import {
  ETIQUETA_ESTUDIO,
  TAMANO_MAXIMO,
  TIPOS_ARCHIVO,
  TIPOS_ESTUDIO,
  esImagen,
  mimeDe,
  nombreSeguro,
  tamanoLegible,
  type Estudio,
  type TipoEstudio,
} from "@/lib/estudios";
import { createClient } from "@/lib/supabase/client";

const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

/**
 * Radiografías y estudios de una pieza, una zona o toda la ficha.
 *
 * El archivo va directo del navegador al bucket privado, en la carpeta de la
 * empresa y de la ficha (la política del bucket lo exige); después se registra
 * qué es. Se ve con un enlace firmado que expira.
 */
export function EstudiosPanel({
  cuentaId,
  organizationId,
  estudios,
  mascotaId,
  pieza,
  region,
  titulo = "Radiografías y estudios",
  tipoInicial = "radiografia",
}: {
  cuentaId: string;
  organizationId: string;
  estudios: Estudio[];
  mascotaId?: string;
  pieza?: number;
  region?: string | null;
  titulo?: string;
  tipoInicial?: TipoEstudio;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [abierto, setAbierto] = useState<Estudio | null>(null);
  const [formulario, setFormulario] = useState(false);
  const [subiendo, startTransition] = useTransition();
  const archivoRef = useRef<HTMLInputElement>(null);

  function adjuntar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const datos = new FormData(event.currentTarget);
    const archivo = archivoRef.current?.files?.[0];
    if (!archivo) {
      toast({ tone: "danger", message: "Elige el archivo." });
      return;
    }
    const mime = mimeDe(archivo.name, archivo.type);
    if (!(TIPOS_ARCHIVO as readonly string[]).includes(mime)) {
      toast({ tone: "danger", message: "Solo JPG, PNG, WebP, PDF o DICOM." });
      return;
    }
    if (archivo.size > TAMANO_MAXIMO) {
      toast({ tone: "danger", message: "El archivo supera los 25 MB." });
      return;
    }
    startTransition(async () => {
      const ruta = `${organizationId}/${cuentaId}/${crypto.randomUUID()}-${nombreSeguro(archivo.name)}`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("estudios-clinicos").upload(ruta, archivo, { contentType: mime, upsert: false });
      if (error) {
        toast({ tone: "danger", message: `No se pudo subir: ${error.message}` });
        return;
      }
      datos.set("storage_path", ruta);
      datos.set("mime", mime);
      datos.set("tamano", String(archivo.size));
      try {
        await registrarEstudio(datos);
        toast({ tone: "success", message: "Estudio adjunto" });
        setFormulario(false);
        router.refresh();
      } catch (causa) {
        toast({ tone: "danger", message: causa instanceof Error ? causa.message : "No se pudo registrar el estudio." });
      }
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo} {estudios.length > 0 && <span className="font-normal">({estudios.length})</span>}
        </p>
        <button type="button" onClick={() => setFormulario((valor) => !valor)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <ImagePlus size={14} aria-hidden="true" /> Adjuntar
        </button>
      </div>

      {estudios.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {estudios.map((estudio) => (
            <button
              key={estudio.id}
              type="button"
              onClick={() => (esImagen(estudio.mime) ? setAbierto(estudio) : estudio.url && window.open(estudio.url, "_blank", "noopener"))}
              className="group overflow-hidden rounded-lg border border-border bg-black text-left"
              title={estudio.titulo}
            >
              <div className="flex aspect-[4/3] items-center justify-center bg-black">
                {esImagen(estudio.mime) && estudio.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={estudio.url} alt={estudio.titulo} className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
                ) : (
                  <FileText size={22} className="text-slate-400" aria-hidden="true" />
                )}
              </div>
              <div className="bg-surface px-1.5 py-1">
                <p className="truncate text-[11px] font-medium text-foreground">{estudio.titulo}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {fecha.format(new Date(`${estudio.fecha}T12:00:00Z`))}
                  {estudio.pieza ? ` · ${estudio.pieza}` : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
      {estudios.length === 0 && !formulario && <p className="text-sm text-muted-foreground">Sin estudios adjuntos.</p>}

      {formulario && (
        <form onSubmit={adjuntar} className="mt-3 space-y-3 rounded-lg border border-border p-3">
          <input type="hidden" name="cuenta_id" value={cuentaId} />
          {mascotaId && <input type="hidden" name="mascota_id" value={mascotaId} />}
          {pieza !== undefined && <input type="hidden" name="pieza" value={pieza} />}
          {region && <input type="hidden" name="region" value={region} />}
          <Field label="Archivo">
            <input
              ref={archivoRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.dcm,image/*,application/pdf,application/dicom"
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
              onChange={(event) => {
                const archivo = event.target.files?.[0];
                const nombre = event.currentTarget.form?.elements.namedItem("titulo") as HTMLInputElement | null;
                if (archivo && nombre && !nombre.value) nombre.value = archivo.name.replace(/\.[^.]+$/, "");
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo">
              <Select name="tipo" defaultValue={tipoInicial}>
                {TIPOS_ESTUDIO.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {ETIQUETA_ESTUDIO[tipo]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha">
              <Input name="fecha" type="date" defaultValue={hoy()} />
            </Field>
          </div>
          <Field label="Nombre">
            <Input name="titulo" required placeholder={pieza ? `Retroalveolar pieza ${pieza}` : "Radiografía lateral"} />
          </Field>
          <Field label="Nota">
            <Input name="nota" placeholder="Hallazgos del informe" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setFormulario(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={subiendo}>
              {subiendo && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {subiendo ? "Subiendo…" : "Adjuntar"}
            </Button>
          </div>
        </form>
      )}

      {abierto && <Visor estudio={abierto} onCerrar={() => setAbierto(null)} />}
    </div>
  );
}

/** Visor tipo radiológico: brillo, contraste, invertir, zoom y rotación. */
function Visor({ estudio, onCerrar }: { estudio: Estudio; onCerrar: () => void }) {
  const [brillo, setBrillo] = useState(100);
  const [contraste, setContraste] = useState(100);
  const [invertir, setInvertir] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [giro, setGiro] = useState(0);

  useEffect(() => {
    const cerrar = (event: KeyboardEvent) => event.key === "Escape" && onCerrar();
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={estudio.titulo}>
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2.5 text-slate-200">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{estudio.titulo}</p>
          <p className="truncate text-xs text-slate-400">
            {ETIQUETA_ESTUDIO[estudio.tipo]} · {fecha.format(new Date(`${estudio.fecha}T12:00:00Z`))}
            {estudio.pieza ? ` · pieza ${estudio.pieza}` : ""}
            {estudio.tamano ? ` · ${tamanoLegible(estudio.tamano)}` : ""}
            {estudio.nota ? ` · ${estudio.nota}` : ""}
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <Sun size={14} aria-hidden="true" />
          <input type="range" min={40} max={200} value={brillo} onChange={(event) => setBrillo(Number(event.target.value))} aria-label="Brillo" className="w-24 accent-sky-400" />
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <Contrast size={14} aria-hidden="true" />
          <input type="range" min={40} max={300} value={contraste} onChange={(event) => setContraste(Number(event.target.value))} aria-label="Contraste" className="w-24 accent-sky-400" />
        </label>
        {[
          { icono: ZoomOut, etiqueta: "Alejar", accion: () => setZoom((valor) => Math.max(0.5, valor / 1.25)) },
          { icono: ZoomIn, etiqueta: "Acercar", accion: () => setZoom((valor) => Math.min(6, valor * 1.25)) },
          { icono: RotateCw, etiqueta: "Rotar", accion: () => setGiro((valor) => (valor + 90) % 360) },
        ].map(({ icono: Icono, etiqueta, accion }) => (
          <button key={etiqueta} type="button" onClick={accion} aria-label={etiqueta} className="rounded-md p-1.5 hover:bg-white/10">
            <Icono size={16} aria-hidden="true" />
          </button>
        ))}
        <button
          type="button"
          onClick={() => setInvertir((valor) => !valor)}
          aria-pressed={invertir}
          className={`rounded-md px-2 py-1 text-xs font-medium ${invertir ? "bg-sky-400 text-slate-950" : "hover:bg-white/10"}`}
        >
          Invertir
        </button>
        <button
          type="button"
          onClick={() => {
            setBrillo(100);
            setContraste(100);
            setInvertir(false);
            setZoom(1);
            setGiro(0);
          }}
          className="rounded-md px-2 py-1 text-xs hover:bg-white/10"
        >
          Restablecer
        </button>
        {estudio.url && (
          <a href={estudio.url} target="_blank" rel="noopener noreferrer" aria-label="Descargar" className="rounded-md p-1.5 hover:bg-white/10">
            <Download size={16} aria-hidden="true" />
          </a>
        )}
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-md p-1.5 hover:bg-white/10">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div
        className="flex flex-1 items-center justify-center overflow-hidden"
        onWheel={(event) => setZoom((valor) => Math.min(6, Math.max(0.5, valor * (event.deltaY < 0 ? 1.1 : 0.9))))}
      >
        {estudio.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={estudio.url}
            alt={estudio.titulo}
            draggable={false}
            className="max-h-full max-w-full select-none transition-transform duration-150"
            style={{
              transform: `scale(${zoom}) rotate(${giro}deg)`,
              filter: `brightness(${brillo}%) contrast(${contraste}%)${invertir ? " invert(1)" : ""}`,
            }}
          />
        )}
      </div>
    </div>
  );
}
