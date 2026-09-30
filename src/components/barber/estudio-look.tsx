"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Box,
  Check,
  Copy,
  ImageIcon,
  Loader2,
  Plus,
  ScanFace,
  Scissors,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

import {
  agregarDelCatalogo,
  aprobarPropuesta,
  crearLook,
  descartarLook,
  enviarLookAlCliente,
  guardarMapaDeCorte,
  proponerPorFacciones,
  registrarConsentimiento,
  registrarFotoDespues,
  revocarConsentimiento,
} from "@/app/actions/looks";
import { Badge, SectionCard, useToast } from "@/components/ui";
import {
  CATALOGO_CORTES,
  DENSIDADES,
  ENTRADAS,
  ESTILOS_BARBA,
  FORMAS_ROSTRO,
  INFO_FORMA,
  INFO_PELO,
  INFO_VISTA,
  MAPA_NEUTRO,
  TIPOS_PELO,
  VISTAS_LOOK,
  resumenMapa,
  type Densidad,
  type Entradas,
  type EstiloBarba,
  type FormaRostro,
  type MapaCorte,
  type PropuestaLook,
  type TipoPelo,
  type VistaLook,
  type Zona,
} from "@/lib/look";
import { createClient } from "@/lib/supabase/client";

import { Camara } from "./camara";
import { EditorMapa } from "./editor-mapa";
import { Escena3D, pedirModelo3D } from "./escena-3d";
import type { IaDisponible, LookFicha, MapaGuardado } from "./tipos";

const fecha = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "short", year: "numeric" });

const PASOS = [
  { id: "foto", nombre: "Foto" },
  { id: "analisis", nombre: "Análisis" },
  { id: "propuestas", nombre: "Propuestas" },
  { id: "mapa", nombre: "Mapa de corte" },
  { id: "resultado", nombre: "Resultado" },
] as const;
type Paso = (typeof PASOS)[number]["id"];

const PEDIDOS_RAPIDOS = ["Algo corto y fácil", "Mantener largo arriba", "Un fade", "Disimular entradas", "Para la oficina", "Arreglar la barba"];

const CTA = "inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-60";
const SECUNDARIO = "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-60";
const SELECT = "h-10 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function pasoInicial(look: LookFicha | null, conMapa: boolean): Paso {
  if (!look) return "foto";
  if (look.estado === "capturado") return "analisis";
  if (look.estado === "analizado") return "propuestas";
  if (look.estado === "aprobado") return conMapa ? "resultado" : "mapa";
  return "resultado";
}

/**
 * Estudio de Look: en el sillón, de la foto al corte.
 *
 * Un paso a la vez, con el avance siempre a la vista: foto, análisis de
 * facciones, propuestas simuladas sobre la foto y en 3D, mapa de corte por
 * zona y el resultado para comparar con la expectativa. Cada paso tiene una
 * sola acción principal.
 */
export function EstudioLook({
  cuentaId,
  organizationId,
  nombre,
  consentimiento,
  looks,
  mapas,
  barberos,
  barberoDeCabecera,
  ia,
}: {
  cuentaId: string;
  organizationId: string;
  nombre: string;
  consentimiento: boolean;
  looks: LookFicha[];
  mapas: MapaGuardado[];
  barberos: string[];
  barberoDeCabecera: string | null;
  ia: IaDisponible;
}) {
  const vigentes = looks.filter((look) => look.estado !== "descartado");
  const [lookId, setLookId] = useState<string | null>(vigentes[0]?.id ?? null);
  const [nuevo, setNuevo] = useState(vigentes.length === 0);
  const look = nuevo ? null : (looks.find((candidato) => candidato.id === lookId) ?? null);
  const mapasDelLook = look ? mapas.filter((mapa) => mapa.look_id === look.id) : [];
  const [pasoElegido, setPasoElegido] = useState<{ look: string | null; paso: Paso } | null>(null);
  const paso: Paso = pasoElegido && pasoElegido.look === (look?.id ?? null) ? pasoElegido.paso : pasoInicial(look, mapasDelLook.length > 0);
  const irA = (siguiente: Paso) => setPasoElegido({ look: look?.id ?? null, paso: siguiente });
  const router = useRouter();
  const { toast } = useToast();
  const [analizando, setAnalizando] = useState<string | null>(null);

  /** El análisis corre en segundo plano: el barbero puede ir mirando el 3D. */
  const analizar = async (id: string) => {
    setAnalizando(id);
    try {
      const respuesta = await fetch(`/api/looks/${id}/analizar`, { method: "POST" });
      const datos = (await respuesta.json().catch(() => ({}))) as { error?: string; fotoUtil?: boolean; problema?: string };
      if (!respuesta.ok) throw new Error(datos.error ?? "El análisis falló.");
      if (datos.fotoUtil === false) toast({ tone: "danger", message: datos.problema || "La foto no sirve para analizar. Toma otra." });
      else toast({ tone: "success", message: "Análisis listo: ya hay cortes propuestos" });
    } catch (error) {
      toast({ tone: "danger", message: error instanceof Error ? error.message : "El análisis falló." });
    } finally {
      setAnalizando(null);
      router.refresh();
    }
  };

  if (!consentimiento) return <PanelConsentimiento cuentaId={cuentaId} nombre={nombre} />;

  const hechos: Record<Paso, boolean> = {
    foto: Boolean(look),
    analisis: Boolean(look?.analisis) || (look?.propuestas.length ?? 0) > 0,
    propuestas: Boolean(look?.propuestaAprobada),
    mapa: mapasDelLook.length > 0,
    resultado: look?.estado === "realizado",
  };
  const alcanzable = (id: Paso) => id === "foto" ? true : Boolean(look) && (id !== "mapa" && id !== "resultado" ? true : Boolean(look?.propuestaAprobada) || id === "mapa");
  const avance = Object.values(hechos).filter(Boolean).length;

  return (
    <SectionCard
      icon={Sparkles}
      tone="amber"
      title="Estudio de Look"
      description={`La foto de ${nombre}, sus facciones, cortes simulados y el mapa que sigue el barbero.`}
      actions={
        !nuevo && (
          <button type="button" onClick={() => setNuevo(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground hover:bg-surface-muted">
            <Plus size={15} aria-hidden="true" /> Nuevo look
          </button>
        )
      }
    >
      {/* Avance: dónde va el look y qué falta. */}
      <nav aria-label="Pasos del Estudio" className="border-b border-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{look ? `Look del ${fecha.format(new Date(look.created_at))}` : "Look nuevo"}</span>
          <span>
            {avance} de {PASOS.length} pasos
          </span>
        </div>
        <ol className="grid grid-cols-5 gap-1.5">
          {PASOS.map((item, indice) => {
            const activo = paso === item.id;
            const puede = alcanzable(item.id) && !(item.id === "foto" && look);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={!puede && !activo}
                  onClick={() => irA(item.id)}
                  aria-current={activo ? "step" : undefined}
                  className="group flex w-full flex-col gap-1.5 text-left disabled:cursor-default"
                >
                  <span className={`h-1.5 rounded-full transition-colors ${hechos[item.id] ? "bg-primary" : activo ? "bg-primary/45" : "bg-border"}`} />
                  <span className={`flex items-center gap-1 truncate text-[11px] sm:text-xs ${activo ? "font-semibold text-foreground" : "text-muted-foreground"} ${puede ? "group-hover:text-foreground" : ""}`}>
                    {hechos[item.id] ? <Check size={12} className="text-primary" aria-hidden="true" /> : <span className="tabular-nums">{indice + 1}.</span>}
                    {item.nombre}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {!nuevo && !look && lookId ? (
        // El look ya se guardó; la ficha se está actualizando. No se vuelve a mostrar la cámara.
        <div className="flex h-[420px] flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 size={20} className="animate-spin text-primary" aria-hidden="true" /> Preparando el look…
        </div>
      ) : nuevo || !look ? (
        <PasoCaptura
          key="captura"
          cuentaId={cuentaId}
          organizationId={organizationId}
          barberos={barberos}
          barberoDeCabecera={barberoDeCabecera}
          ia={ia}
          puedeCancelar={vigentes.length > 0}
          onCancelar={() => setNuevo(false)}
          onCreado={(id) => {
            setLookId(id);
            setNuevo(false);
            setPasoElegido({ look: id, paso: "analisis" });
            // Apenas está la foto: el 3D del cliente y el análisis parten solos, en paralelo.
            if (ia.modelo3d) void pedirModelo3D(id, null).then(() => router.refresh());
            if (ia.analisis) void analizar(id);
          }}
        />
      ) : paso === "analisis" ? (
        <PasoAnalisis key={`analisis-${look.id}`} look={look} ia={ia} nombre={nombre} analizando={analizando === look.id} onAnalizar={() => void analizar(look.id)} onListo={() => irA("propuestas")} />
      ) : paso === "propuestas" ? (
        <PasoPropuestas key={`propuestas-${look.id}`} look={look} ia={ia} nombre={nombre} onAprobado={() => irA("mapa")} />
      ) : paso === "mapa" ? (
        <PasoMapa key={`mapa-${look.id}`} cuentaId={cuentaId} look={look} ia={ia} guardados={mapasDelLook} ultimo={mapas[0] ?? null} barberos={barberos} onGuardado={() => irA("resultado")} />
      ) : (
        <PasoResultado key={`resultado-${look.id}`} look={look} organizationId={organizationId} cuentaId={cuentaId} />
      )}

      <Historial
        looks={looks}
        actual={nuevo ? null : (look?.id ?? null)}
        onAbrir={(id) => {
          setLookId(id);
          setNuevo(false);
        }}
        cuentaId={cuentaId}
      />
    </SectionCard>
  );
}

function Escenario({ children, claro = false }: { children: React.ReactNode; claro?: boolean }) {
  return (
    <div
      className={`relative h-[420px] overflow-hidden rounded-xl sm:h-[520px] ${
        claro ? "bg-[radial-gradient(ellipse_at_top,#f7f3ee,#e7e1d8)]" : "bg-[radial-gradient(ellipse_at_top,#2b2622,#0f0d0b)]"
      }`}
    >
      {children}
    </div>
  );
}

function Diseno({ escenario, panel }: { escenario: React.ReactNode; panel: React.ReactNode }) {
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="min-w-0">{escenario}</div>
      <div className="min-w-0 space-y-4">{panel}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Consentimiento
// ---------------------------------------------------------------------------

function PanelConsentimiento({ cuentaId, nombre }: { cuentaId: string; nombre: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [acepta, setAcepta] = useState(false);
  const [pendiente, iniciar] = useTransition();
  return (
    <SectionCard icon={Sparkles} tone="amber" title="Estudio de Look" description="Simula cortes sobre la foto del cliente y deja el mapa de corte en su ficha.">
      <div className="grid gap-5 p-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ShieldCheck size={24} aria-hidden="true" />
        </span>
        <div className="max-w-xl space-y-3">
          <h3 className="text-base font-semibold text-foreground">Antes de la primera foto, la autorización de {nombre}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            La foto de la cara es un dato sensible. Se usa solo para proponerle cortes y simularlos con inteligencia artificial, no se comparte con nadie más,
            las fotos originales se borran solas a los 90 días y puede retirar la autorización cuando quiera: se borran todas en el momento.
          </p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-muted/50 p-3 text-sm text-foreground">
            <input type="checkbox" checked={acepta} onChange={(evento) => setAcepta(evento.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
            <span>{nombre} leyó esto y autoriza que le tomemos fotos para el Estudio de Look.</span>
          </label>
          <button
            type="button"
            disabled={!acepta || pendiente}
            onClick={() =>
              iniciar(async () => {
                const resultado = await registrarConsentimiento(cuentaId);
                if (!resultado.ok) {
                  toast({ tone: "danger", message: resultado.error });
                  return;
                }
                toast({ tone: "success", message: "Autorización registrada" });
                router.refresh();
              })
            }
            className={`${CTA} sm:w-auto sm:px-6`}
          >
            {pendiente ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />} Registrar autorización y empezar
          </button>
        </div>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// 1. Foto
// ---------------------------------------------------------------------------

function PasoCaptura({
  cuentaId,
  organizationId,
  barberos,
  barberoDeCabecera,
  ia,
  puedeCancelar,
  onCancelar,
  onCreado,
}: {
  cuentaId: string;
  organizationId: string;
  barberos: string[];
  barberoDeCabecera: string | null;
  ia: IaDisponible;
  puedeCancelar: boolean;
  onCancelar: () => void;
  onCreado: (id: string) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [cual, setCual] = useState<"frente" | "perfil">("frente");
  const [frente, setFrente] = useState<{ blob: Blob; url: string } | null>(null);
  const [perfil, setPerfil] = useState<{ blob: Blob; url: string } | null>(null);
  const [pedido, setPedido] = useState("");
  const [barbero, setBarbero] = useState(barberoDeCabecera ?? barberos[0] ?? "");
  const [estado, setEstado] = useState<string | null>(null);

  const actual = cual === "frente" ? frente : perfil;
  const guardar = async () => {
    if (!frente) return;
    const lookId = crypto.randomUUID();
    const carpeta = `${organizationId}/${cuentaId}/${lookId}`;
    const supabase = createClient();
    try {
      setEstado("Subiendo la foto…");
      const subir = async (blob: Blob, nombreArchivo: string) => {
        const ruta = `${carpeta}/${nombreArchivo}`;
        const { error } = await supabase.storage.from("looks").upload(ruta, blob, { contentType: "image/jpeg", upsert: false });
        if (error) throw new Error("No se pudo subir la foto. Revisa la conexión y prueba otra vez.");
        return ruta;
      };
      const [fotoPath, perfilPath] = await Promise.all([subir(frente.blob, "frente.jpg"), perfil ? subir(perfil.blob, "perfil.jpg") : Promise.resolve(null)]);
      setEstado("Guardando el look…");
      const resultado = await crearLook({ cuentaId, fotoPath, perfilPath, pedido, barbero });
      if (!resultado.ok) throw new Error(resultado.error);
      router.refresh();
      onCreado(resultado.id);
    } catch (error) {
      toast({ tone: "danger", message: error instanceof Error ? error.message : "No se pudo guardar." });
    } finally {
      setEstado(null);
    }
  };

  return (
    <Diseno
      escenario={
        <div className="space-y-2">
          <div className="flex gap-1.5" role="tablist" aria-label="Fotos">
            {(["frente", "perfil"] as const).map((opcion) => (
              <button
                key={opcion}
                type="button"
                role="tab"
                aria-selected={cual === opcion}
                onClick={() => setCual(opcion)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
                  cual === opcion ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground"
                }`}
              >
                {(opcion === "frente" ? frente : perfil) && <Check size={14} aria-hidden="true" />}
                {opcion === "frente" ? "De frente" : "De perfil (opcional)"}
              </button>
            ))}
          </div>
          <Escenario>
            <Camara
              key={cual}
              guia={cual}
              foto={actual?.url ?? null}
              onRepetir={() => (cual === "frente" ? setFrente(null) : setPerfil(null))}
              onFoto={(blob) => {
                const valor = { blob, url: URL.createObjectURL(blob) };
                if (cual === "frente") {
                  setFrente(valor);
                  if (!perfil) setCual("perfil");
                } else {
                  setPerfil(valor);
                }
              }}
            />
          </Escenario>
        </div>
      }
      panel={
        <>
          <div className="space-y-2">
            <label htmlFor="pedido-look" className="text-sm font-medium text-foreground">
              ¿Qué pide el cliente?
            </label>
            <textarea
              id="pedido-look"
              value={pedido}
              onChange={(evento) => setPedido(evento.target.value)}
              rows={3}
              maxLength={600}
              placeholder="En sus palabras: “algo moderno pero que no tenga que peinar”"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap gap-1.5">
              {PEDIDOS_RAPIDOS.map((rapido) => (
                <button
                  key={rapido}
                  type="button"
                  onClick={() => setPedido((actualPedido) => (actualPedido.includes(rapido) ? actualPedido : `${actualPedido ? `${actualPedido}. ` : ""}${rapido}`))}
                  className="min-h-9 rounded-full border border-border bg-surface px-3 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {rapido}
                </button>
              ))}
            </div>
          </div>
          {barberos.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="barbero-look" className="text-sm font-medium text-foreground">
                Barbero
              </label>
              <select id="barbero-look" value={barbero} onChange={(evento) => setBarbero(evento.target.value)} className={SELECT}>
                {barberos.map((opcion) => (
                  <option key={opcion}>{opcion}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-2 pt-1">
            <button type="button" disabled={!frente || Boolean(estado)} onClick={() => void guardar()} className={CTA}>
              {estado ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ScanFace size={16} aria-hidden="true" />}
              {estado ?? (ia.analisis ? "Guardar y analizar" : "Guardar y elegir cortes")}
            </button>
            <p className="text-center text-xs text-muted-foreground">
              {frente ? (perfil ? "Frente y perfil listos." : "Con la foto de frente basta; el perfil mejora la simulación.") : "Falta la foto de frente."}
            </p>
            {puedeCancelar && (
              <button type="button" onClick={onCancelar} className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
                Volver al look anterior
              </button>
            )}
          </div>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// 2. Análisis
// ---------------------------------------------------------------------------

const MENSAJES_ANALISIS = ["Leyendo las facciones…", "Mirando el tipo de pelo y las entradas…", "Pensando cortes que le queden bien…", "Armando el mapa de cada corte…"];

function PasoAnalisis({
  look,
  ia,
  nombre,
  analizando,
  onAnalizar,
  onListo,
}: {
  look: LookFicha;
  ia: IaDisponible;
  nombre: string;
  analizando: boolean;
  onAnalizar: () => void;
  onListo: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [manual, setManual] = useState(!ia.analisis);
  const [pendiente, iniciar] = useTransition();
  const analisis = look.analisis;
  const [facciones, setFacciones] = useState<{ forma: FormaRostro; pelo: TipoPelo; densidad: Densidad; entradas: Entradas; barba: EstiloBarba }>({
    forma: analisis?.rostro.forma ?? "ovalado",
    pelo: analisis?.pelo.tipo ?? "liso",
    densidad: analisis?.pelo.densidad ?? "media",
    entradas: analisis?.pelo.entradas ?? "no",
    barba: analisis?.barba.tiene ? "corta" : "sin_barba",
  });

  const proponer = () =>
    iniciar(async () => {
      const resultado = await proponerPorFacciones(look.id, { ...facciones, pedido: look.pedido ?? undefined });
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      toast({ tone: "success", message: `${resultado.propuestas} cortes propuestos` });
      router.refresh();
      onListo();
    });

  return (
    <Diseno
      escenario={
        <Escenario>
          {look.fotosBorradas && !look.modelo?.url ? (
            <SinFoto />
          ) : (
            <Escena3D
              key={`cliente-${look.id}`}
              lookId={look.id}
              propuestaId={null}
              inicial={look.modelo}
              fondo={look.foto}
              titulo={`${nombre} hoy`}
              disponible={ia.modelo3d}
              puedePedir={Boolean(look.foto)}
              sinPoder="Falta la foto de frente."
            />
          )}
          {analizando && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/75 to-transparent px-6 pb-5 pt-12 text-sm font-medium text-white">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" /> <MensajeRotativo mensajes={MENSAJES_ANALISIS} />
            </div>
          )}
        </Escenario>
      }
      panel={
        <>
          {analisis && analisis.foto_util && (
            <div className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="info">Rostro {INFO_FORMA[analisis.rostro.forma].nombre.toLowerCase()}</Badge>
                <Badge tone="neutral">Pelo {INFO_PELO[analisis.pelo.tipo].toLowerCase()}</Badge>
                <Badge tone="neutral">Densidad {analisis.pelo.densidad}</Badge>
                {analisis.pelo.entradas !== "no" && <Badge tone="warning">Entradas {analisis.pelo.entradas}</Badge>}
                {analisis.barba.tiene && <Badge tone="neutral">Barba {analisis.barba.densidad}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{INFO_FORMA[analisis.rostro.forma].claves}</p>
              {analisis.notas_para_barbero && (
                <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-foreground">
                  <span className="font-medium">Para el barbero: </span>
                  {analisis.notas_para_barbero}
                </p>
              )}
              {analisis.evitar.length > 0 && (
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {analisis.evitar.map((item) => (
                    <li key={item.nombre}>
                      <span className="font-medium text-foreground">Evitar {item.nombre.toLowerCase()}:</span> {item.por_que}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {analisis && !analisis.foto_util && (
            <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground">{analisis.problema_foto || "La foto no sirve para analizar."} Crea un look nuevo con otra foto.</p>
          )}

          {look.propuestas.length > 0 && !analizando ? (
            <button type="button" onClick={onListo} className={CTA}>
              <Scissors size={16} aria-hidden="true" /> Ver los {look.propuestas.length} cortes propuestos
            </button>
          ) : ia.analisis && !manual ? (
            <div className="space-y-2">
              <button type="button" onClick={onAnalizar} disabled={analizando} className={CTA}>
                {analizando ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                {analizando ? "Analizando…" : analisis ? "Volver a analizar" : "Analizar con IA"}
              </button>
              <p className="text-center text-xs text-muted-foreground">Tarda entre 20 y 40 segundos. Lee facciones, pelo y barba, y propone 3 o 4 cortes.</p>
            </div>
          ) : null}

          {(manual || !ia.analisis) && !analizando && (
            <div className="space-y-3">
              {!ia.analisis && <p className="text-sm text-muted-foreground">Indica las facciones y el catálogo propone los cortes.</p>}
              <div className="grid grid-cols-2 gap-3">
                <SelectorFaccion etiqueta="Forma del rostro" valor={facciones.forma} opciones={FORMAS_ROSTRO.map((forma) => [forma, INFO_FORMA[forma].nombre])} onChange={(forma) => setFacciones({ ...facciones, forma: forma as FormaRostro })} />
                <SelectorFaccion etiqueta="Tipo de pelo" valor={facciones.pelo} opciones={TIPOS_PELO.map((pelo) => [pelo, INFO_PELO[pelo]])} onChange={(pelo) => setFacciones({ ...facciones, pelo: pelo as TipoPelo })} />
                <SelectorFaccion etiqueta="Densidad" valor={facciones.densidad} opciones={DENSIDADES.map((densidad) => [densidad, densidad[0].toUpperCase() + densidad.slice(1)])} onChange={(densidad) => setFacciones({ ...facciones, densidad: densidad as Densidad })} />
                <SelectorFaccion etiqueta="Entradas" valor={facciones.entradas} opciones={ENTRADAS.map((entradas) => [entradas, entradas === "no" ? "No tiene" : entradas[0].toUpperCase() + entradas.slice(1)])} onChange={(entradas) => setFacciones({ ...facciones, entradas: entradas as Entradas })} />
                <div className="col-span-2">
                  <SelectorFaccion etiqueta="Barba" valor={facciones.barba} opciones={ESTILOS_BARBA.map((barba) => [barba.id, barba.nombre])} onChange={(barba) => setFacciones({ ...facciones, barba: barba as EstiloBarba })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{INFO_FORMA[facciones.forma].claves}</p>
              <button type="button" onClick={proponer} disabled={pendiente} className={look.propuestas.length > 0 ? `${SECUNDARIO} w-full` : CTA}>
                {pendiente ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Wand2 size={16} aria-hidden="true" />} Proponer cortes por facciones
              </button>
            </div>
          )}
          {ia.analisis && !manual && !analizando && (
            <button type="button" onClick={() => setManual(true)} className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
              Indicar las facciones a mano
            </button>
          )}
          {look.pedido && <p className="text-xs text-muted-foreground">Pidió: “{look.pedido}”</p>}
        </>
      }
    />
  );
}

function MensajeRotativo({ mensajes }: { mensajes: string[] }) {
  const [indice, setIndice] = useState(0);
  useEffect(() => {
    const reloj = window.setInterval(() => setIndice((actual) => Math.min(actual + 1, mensajes.length - 1)), 7000);
    return () => window.clearInterval(reloj);
  }, [mensajes.length]);
  return <span>{mensajes[indice]}</span>;
}

function SelectorFaccion({ etiqueta, valor, opciones, onChange }: { etiqueta: string; valor: string; opciones: [string, string][]; onChange: (valor: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{etiqueta}</span>
      <select value={valor} onChange={(evento) => onChange(evento.target.value)} className={SELECT}>
        {opciones.map(([id, nombre]) => (
          <option key={id} value={id}>
            {nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

function SinFoto() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/70">
      <ImageIcon size={22} aria-hidden="true" />
      Las fotos de este look se borraron (pasaron 90 días o el cliente retiró su autorización). El mapa de corte sigue guardado.
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Propuestas
// ---------------------------------------------------------------------------

function PasoPropuestas({ look, ia, nombre, onAprobado }: { look: LookFicha; ia: IaDisponible; nombre: string; onAprobado: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [elegida, setElegida] = useState<string | null>(look.propuestaAprobada ?? look.propuestas[0]?.id ?? null);
  const propuesta = look.propuestas.find((candidata) => candidata.id === elegida) ?? look.propuestas[0] ?? null;
  const [modo, setModo] = useState<"3d" | "fotos">("3d");
  const [quien, setQuien] = useState<"corte" | "hoy">("corte");
  const [vista, setVista] = useState<VistaLook>("frontal");
  const [comparar, setComparar] = useState(50);
  const [generadas, setGeneradas] = useState<Record<string, Partial<Record<VistaLook, string>>>>({});
  const [generando, setGenerando] = useState<Set<string>>(new Set());
  const [catalogo, setCatalogo] = useState({ corte: CATALOGO_CORTES[0].id, barba: "sin_barba" as EstiloBarba });
  const [pendiente, iniciar] = useTransition();

  const vistas = propuesta ? { ...propuesta.vistas, ...(generadas[propuesta.id] ?? {}) } : {};
  const vistasListas = VISTAS_LOOK.filter((opcion) => vistas[opcion]).length;
  const generandoEsta = propuesta ? VISTAS_LOOK.some((opcion) => generando.has(`${propuesta.id}:${opcion}`)) : false;

  /** Probar un corte: simula las cuatro vistas y, con ellas, arma su 3D. */
  const probar = async (objetivo: PropuestaLook) => {
    const pendientes = VISTAS_LOOK.filter((opcion) => !(objetivo.vistas[opcion] || generadas[objetivo.id]?.[opcion]));
    setGenerando((actual) => new Set([...actual, ...pendientes.map((opcion) => `${objetivo.id}:${opcion}`)]));
    let listas = VISTAS_LOOK.length - pendientes.length;
    let mensajeFalla = "";
    await Promise.all(
      pendientes.map(async (opcion) => {
        try {
          const respuesta = await fetch(`/api/looks/${look.id}/vistas`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ propuesta: objetivo.id, vista: opcion }),
          });
          const datos = (await respuesta.json().catch(() => ({}))) as { url?: string; error?: string };
          if (!respuesta.ok || !datos.url) throw new Error(datos.error ?? "Falló una vista.");
          listas += 1;
          setGeneradas((actual) => ({ ...actual, [objetivo.id]: { ...(actual[objetivo.id] ?? {}), [opcion]: datos.url } }));
        } catch (error) {
          mensajeFalla = error instanceof Error ? error.message : "Falló una vista.";
        } finally {
          setGenerando((actual) => {
            const siguiente = new Set(actual);
            siguiente.delete(`${objetivo.id}:${opcion}`);
            return siguiente;
          });
        }
      }),
    );
    if (mensajeFalla) toast({ tone: "danger", message: listas === 0 ? mensajeFalla : `${VISTAS_LOOK.length - listas} vistas fallaron; el resto quedó.` });
    if (listas >= 2 && ia.modelo3d && !objetivo.modelo) {
      const error = await pedirModelo3D(look.id, objetivo.id);
      if (error) toast({ tone: "danger", message: error });
    }
    router.refresh();
  };

  const aprobar = () =>
    propuesta &&
    iniciar(async () => {
      const resultado = await aprobarPropuesta(look.id, propuesta.id);
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      toast({ tone: "success", message: `${propuesta.nombre}: aprobado` });
      router.refresh();
      onAprobado();
    });

  const agregar = () =>
    iniciar(async () => {
      const resultado = await agregarDelCatalogo(look.id, catalogo.corte, catalogo.barba);
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      setElegida(resultado.id);
      router.refresh();
    });

  if (look.propuestas.length === 0) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Todavía no hay propuestas. Vuelve al paso de análisis para que la IA o el catálogo propongan cortes.</div>;
  }

  const sinProbar = propuesta && vistasListas === 0 && !generandoEsta;

  return (
    <Diseno
      escenario={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1.5" role="tablist" aria-label="Cómo ver el corte">
              {(
                [
                  ["3d", "En 3D", Box],
                  ["fotos", "Fotos", ImageIcon],
                ] as const
              ).map(([id, etiqueta, Icono]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={modo === id}
                  onClick={() => setModo(id)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
                    modo === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icono size={14} aria-hidden="true" /> {etiqueta}
                </button>
              ))}
            </div>
            {modo === "3d" ? (
              <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Comparar">
                {(
                  [
                    ["hoy", `${nombre} hoy`],
                    ["corte", "Con este corte"],
                  ] as const
                ).map(([id, etiqueta]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setQuien(id)}
                    className={`h-8 rounded-md px-3 text-xs transition-colors ${quien === id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {etiqueta}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {VISTAS_LOOK.map((opcion) => (
                  <button
                    key={opcion}
                    type="button"
                    onClick={() => setVista(opcion)}
                    className={`h-8 rounded-md px-2.5 text-xs transition-colors ${vista === opcion ? "bg-foreground text-background" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"}`}
                  >
                    {INFO_VISTA[opcion].nombre}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Escenario>
            {modo === "3d" && quien === "hoy" ? (
              <Escena3D key={`cliente-${look.id}`} lookId={look.id} propuestaId={null} inicial={look.modelo} fondo={look.foto} titulo={`${nombre} hoy`} disponible={ia.modelo3d} puedePedir={Boolean(look.foto)} sinPoder="Falta la foto de frente." />
            ) : modo === "3d" && propuesta && !sinProbar ? (
              <Escena3D
                key={`corte-${propuesta.id}`}
                lookId={look.id}
                propuestaId={propuesta.id}
                inicial={propuesta.modelo ?? null}
                fondo={vistas.tres_cuartos ?? vistas.frontal ?? look.foto}
                titulo={propuesta.nombre}
                disponible={ia.modelo3d}
                puedePedir={vistasListas >= 2}
                sinPoder={generandoEsta ? `Simulando las vistas del corte (${vistasListas} de 4)…` : "Faltan vistas simuladas para armar el 3D."}
              />
            ) : modo === "fotos" && vistas[vista] ? (
              <Comparador antes={look.foto} despues={vistas[vista] as string} posicion={vista === "frontal" ? comparar : 100} onPosicion={setComparar} />
            ) : (
              <div className="relative flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                {look.foto && (
                  // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado
                  <img src={look.foto} alt="" className="absolute inset-0 h-full w-full object-contain opacity-25" />
                )}
                <div className="relative flex flex-col items-center gap-3">
                  {propuesta && generandoEsta ? (
                    <>
                      <Loader2 size={24} className="animate-spin text-[#e0b36e]" aria-hidden="true" />
                      <p className="text-sm font-medium text-white">Probando {propuesta.nombre.toLowerCase()} sobre {nombre}…</p>
                      <p className="text-xs text-white/70">Primero las fotos ({vistasListas} de 4), después el 3D.</p>
                    </>
                  ) : ia.simulacion && propuesta ? (
                    <>
                      <Sparkles size={24} className="text-[#e0b36e]" aria-hidden="true" />
                      <p className="max-w-sm text-sm text-white/85">Simula {propuesta.nombre.toLowerCase()} sobre la foto de {nombre} en cuatro ángulos y arma su 3D.</p>
                      <button type="button" onClick={() => void probar(propuesta)} className="inline-flex h-11 items-center gap-2 rounded-full border border-[#e0b36e] px-5 text-sm font-semibold text-[#e0b36e] hover:bg-[#e0b36e]/10">
                        <Sparkles size={16} aria-hidden="true" /> Probar este corte
                      </button>
                      <p className="text-xs text-white/55">Las fotos tardan unos 20 segundos; el 3D, 1 a 3 minutos más.</p>
                    </>
                  ) : (
                    <>
                      <ImageIcon size={24} className="text-[#e0b36e]" aria-hidden="true" />
                      <p className="max-w-sm text-sm text-white/85">La simulación todavía no está activa en esta barbería. Se activa con la cuenta de fal.ai en la configuración de Atlas.</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </Escenario>
          {modo === "fotos" && vistasListas > 0 && (
            <div className="grid grid-cols-5 gap-2">
              {look.foto && <Miniatura url={look.foto} etiqueta="Antes" activa={false} onClick={() => undefined} />}
              {VISTAS_LOOK.map((opcion) => (
                <Miniatura
                  key={opcion}
                  url={vistas[opcion] ?? null}
                  cargando={propuesta ? generando.has(`${propuesta.id}:${opcion}`) : false}
                  etiqueta={INFO_VISTA[opcion].nombre}
                  activa={vista === opcion}
                  onClick={() => setVista(opcion)}
                />
              ))}
            </div>
          )}
          {propuesta && ia.simulacion && vistasListas > 0 && vistasListas < VISTAS_LOOK.length && !generandoEsta && (
            <button type="button" onClick={() => void probar(propuesta)} className="text-sm text-primary hover:underline">
              Simular las vistas que faltan
            </button>
          )}
        </div>
      }
      panel={
        <>
          <ul className="space-y-2">
            {look.propuestas.map((opcion, indice) => {
              const activa = propuesta?.id === opcion.id;
              const aprobada = look.propuestaAprobada === opcion.id;
              return (
                <li key={opcion.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setElegida(opcion.id);
                      setQuien("corte");
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${activa ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/50"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        <span className="mr-1.5 tabular-nums text-muted-foreground">{indice + 1}.</span>
                        {opcion.nombre}
                      </p>
                      <div className="flex flex-shrink-0 gap-1">
                        {aprobada && <Badge tone="success">Aprobado</Badge>}
                        {opcion.modelo?.estado === "listo" && <Badge tone="info">3D</Badge>}
                        <Badge tone="neutral">{opcion.origen === "ia" ? "IA" : opcion.origen === "reglas" ? "Catálogo" : "Barbero"}</Badge>
                      </div>
                    </div>
                    {activa && (
                      <div className="mt-2 space-y-1.5 text-sm">
                        <p className="text-muted-foreground">{opcion.por_que}</p>
                        {opcion.que_decirle && <p className="text-foreground">“{opcion.que_decirle}”</p>}
                        <p className="text-xs text-muted-foreground">
                          Mantención cada {opcion.mantencion_semanas} semanas · dificultad {opcion.dificultad}
                          {opcion.barba ? ` · ${opcion.barba.toLowerCase()}` : ""}
                        </p>
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {propuesta && (
            <button type="button" onClick={aprobar} disabled={pendiente || look.propuestaAprobada === propuesta.id} className={CTA}>
              {pendiente ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
              {look.propuestaAprobada === propuesta.id ? "Este es el look aprobado" : "Aprobar este look"}
            </button>
          )}

          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Probar otro corte del catálogo</summary>
            <div className="mt-3 space-y-2">
              <SelectorFaccion etiqueta="Corte" valor={catalogo.corte} opciones={CATALOGO_CORTES.map((corte) => [corte.id, corte.nombre])} onChange={(corte) => setCatalogo({ ...catalogo, corte })} />
              <SelectorFaccion etiqueta="Barba" valor={catalogo.barba} opciones={ESTILOS_BARBA.map((barba) => [barba.id, barba.nombre])} onChange={(barba) => setCatalogo({ ...catalogo, barba: barba as EstiloBarba })} />
              <button type="button" onClick={agregar} disabled={pendiente} className={`${SECUNDARIO} w-full`}>
                <Plus size={16} aria-hidden="true" /> Agregar como propuesta
              </button>
            </div>
          </details>
        </>
      }
    />
  );
}

function Miniatura({ url, etiqueta, activa, onClick, cargando = false }: { url: string | null; etiqueta: string; activa: boolean; onClick: () => void; cargando?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`overflow-hidden rounded-lg border text-left ${activa ? "border-primary ring-2 ring-primary/30" : "border-border"}`}>
      <div className="aspect-[4/5] bg-[#1a1714]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado
          <img src={url} alt={etiqueta} className="h-full w-full object-cover" />
        ) : (
          <div className={`flex h-full items-center justify-center ${cargando ? "animate-pulse bg-white/10" : ""}`}>
            {cargando && <Loader2 size={14} className="animate-spin text-white/60" aria-hidden="true" />}
          </div>
        )}
      </div>
      <p className="truncate px-1.5 py-1 text-[11px] text-muted-foreground">{etiqueta}</p>
    </button>
  );
}

/** Antes y después sobre la misma foto: se arrastra la línea. */
function Comparador({ antes, despues, posicion, onPosicion }: { antes: string | null; despues: string; posicion: number; onPosicion: (valor: number) => void }) {
  return (
    <div className="relative h-full w-full select-none">
      {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado */}
      <img src={despues} alt="Simulación" className="absolute inset-0 h-full w-full object-contain" />
      {antes && posicion < 100 && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado */}
          <img src={antes} alt="Antes" className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - posicion}% 0 0)` }} />
          <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow" style={{ left: `${posicion}%` }} />
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-xs text-white">Antes</span>
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-xs text-white">Simulación</span>
          <input
            type="range"
            min={0}
            max={100}
            value={posicion}
            onChange={(evento) => onPosicion(Number(evento.target.value))}
            aria-label="Comparar antes y simulación"
            className="absolute inset-x-6 bottom-4 accent-[#e0b36e]"
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Mapa de corte
// ---------------------------------------------------------------------------

function PasoMapa({
  cuentaId,
  look,
  ia,
  guardados,
  ultimo,
  barberos,
  onGuardado,
}: {
  cuentaId: string;
  look: LookFicha;
  ia: IaDisponible;
  guardados: MapaGuardado[];
  ultimo: MapaGuardado | null;
  barberos: string[];
  onGuardado: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const aprobada = look.propuestas.find((propuesta) => propuesta.id === look.propuestaAprobada) ?? null;
  const [mapa, setMapa] = useState<MapaCorte>(guardados[0]?.mapa ?? aprobada?.mapa ?? ultimo?.mapa ?? MAPA_NEUTRO);
  const [zona, setZona] = useState<Zona | null>("lateral_bajo");
  const referencia = aprobada?.vistas.tres_cuartos ?? aprobada?.vistas.frontal ?? null;
  const [nota, setNota] = useState(guardados[0]?.nota ?? "");
  const [barbero, setBarbero] = useState(look.barbero ?? barberos[0] ?? "");
  const [pendiente, iniciar] = useTransition();
  const cambiado = JSON.stringify(mapa) !== JSON.stringify(guardados[0]?.mapa ?? null);

  const guardar = () =>
    iniciar(async () => {
      const resultado = await guardarMapaDeCorte({ cuentaId, lookId: look.id, nombre: aprobada?.nombre ?? null, mapa, nota, profesional: barbero });
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      toast({ tone: "success", message: "Mapa de corte guardado en la ficha" });
      router.refresh();
      onGuardado();
    });

  return (
    <Diseno
      escenario={
        <div className="space-y-2">
          <Escenario>
            {aprobada ? (
              <Escena3D
                key={`mapa-${aprobada.id}`}
                lookId={look.id}
                propuestaId={aprobada.id}
                inicial={aprobada.modelo ?? null}
                fondo={referencia ?? look.foto}
                titulo={aprobada.nombre}
                disponible={ia.modelo3d}
                puedePedir={Object.keys(aprobada.vistas).length >= 2}
                sinPoder="El 3D se arma con las vistas simuladas del look aprobado."
              />
            ) : look.foto ? (
              // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado
              <img src={look.foto} alt="Foto del cliente" className="h-full w-full object-contain" />
            ) : (
              <SinFoto />
            )}
          </Escenario>
          <p className="text-xs text-muted-foreground">La ficha técnica (a la derecha) es lo que queda en la historia del cliente para repetir el corte igual.</p>
        </div>
      }
      panel={
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{aprobada ? aprobada.nombre : "Mapa de corte"}</p>
            {guardados[0] && <Badge tone="success">Guardado {fecha.format(new Date(guardados[0].created_at))}</Badge>}
          </div>
          <div className="max-h-[430px] overflow-y-auto pr-1">
            <EditorMapa mapa={mapa} seleccionada={zona} onSelect={setZona} onChange={setMapa} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {barberos.length > 0 && (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Barbero</span>
                <select value={barbero} onChange={(evento) => setBarbero(evento.target.value)} className={SELECT}>
                  {barberos.map((opcion) => (
                    <option key={opcion}>{opcion}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Nota técnica</span>
              <input value={nota} onChange={(evento) => setNota(evento.target.value)} maxLength={800} placeholder="Remolino en coronilla, cortar a favor" className={SELECT} />
            </label>
          </div>
          <button type="button" onClick={guardar} disabled={pendiente || (!cambiado && Boolean(guardados[0]))} className={CTA}>
            {pendiente ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Scissors size={16} aria-hidden="true" />}
            {guardados[0] && !cambiado ? "Mapa guardado" : "Guardar mapa de corte"}
          </button>
          {ultimo && ultimo.look_id !== look.id && (
            <button type="button" onClick={() => setMapa(ultimo.mapa)} className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
              Usar el último corte ({fecha.format(new Date(ultimo.created_at))}{ultimo.profesional ? `, ${ultimo.profesional}` : ""})
            </button>
          )}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// 5. Resultado
// ---------------------------------------------------------------------------

function PasoResultado({ look, organizationId, cuentaId }: { look: LookFicha; organizationId: string; cuentaId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [foto, setFoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [enlace, setEnlace] = useState<string | null>(null);
  const aprobada = look.propuestas.find((propuesta) => propuesta.id === look.propuestaAprobada) ?? null;
  const esperado = aprobada?.vistas.frontal ?? null;
  const despues = foto?.url ?? look.fotoDespues;

  const guardarFoto = () =>
    foto &&
    iniciar(async () => {
      const ruta = `${organizationId}/${cuentaId}/${look.id}/despues-${Date.now()}.jpg`;
      const { error } = await createClient().storage.from("looks").upload(ruta, foto.blob, { contentType: "image/jpeg", upsert: false });
      if (error) {
        toast({ tone: "danger", message: "No se pudo subir la foto." });
        return;
      }
      const resultado = await registrarFotoDespues(look.id, ruta);
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      toast({ tone: "success", message: "Resultado guardado" });
      router.refresh();
    });

  const enviar = () =>
    iniciar(async () => {
      const resultado = await enviarLookAlCliente(look.id);
      if (!resultado.ok) {
        toast({ tone: "danger", message: resultado.error });
        return;
      }
      setEnlace(resultado.url);
      toast({ tone: "success", message: "Look enviado al cliente" });
      router.refresh();
    });

  return (
    <Diseno
      escenario={
        <div className="grid grid-cols-2 gap-2">
          <figure className="space-y-1">
            <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_top,#2b2622,#0f0d0b)]">
              {esperado ? (
                // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado
                <img src={esperado} alt="Lo que se esperaba" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center p-4 text-center text-xs text-white/60">Sin simulación en foto. El mapa de corte es la referencia.</div>
              )}
            </div>
            <figcaption className="text-xs text-muted-foreground">Lo esperado{aprobada ? ` · ${aprobada.nombre}` : ""}</figcaption>
          </figure>
          <figure className="space-y-1">
            <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-[radial-gradient(ellipse_at_top,#2b2622,#0f0d0b)]">
              {despues ? (
                // eslint-disable-next-line @next/next/no-img-element -- foto local o enlace firmado
                <img src={despues} alt="Resultado" className="h-full w-full object-cover" />
              ) : (
                <Camara guia="frente" foto={null} onRepetir={() => setFoto(null)} onFoto={(blob) => setFoto({ blob, url: URL.createObjectURL(blob) })} />
              )}
            </div>
            <figcaption className="text-xs text-muted-foreground">El resultado</figcaption>
          </figure>
        </div>
      }
      panel={
        <>
          {aprobada && (
            <div className="rounded-xl border border-border p-3 text-sm">
              <p className="font-semibold text-foreground">{aprobada.nombre}</p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
                {resumenMapa(aprobada.mapa).slice(0, 6).map((linea) => (
                  <li key={linea}>{linea}</li>
                ))}
              </ul>
            </div>
          )}
          {foto && !look.fotoDespues ? (
            <div className="space-y-2">
              <button type="button" onClick={guardarFoto} disabled={pendiente} className={CTA}>
                {pendiente ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} Guardar resultado
              </button>
              <button type="button" onClick={() => setFoto(null)} className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
                Repetir foto
              </button>
            </div>
          ) : look.estado === "realizado" || look.estado === "aprobado" ? (
            <div className="space-y-2">
              <button type="button" onClick={enviar} disabled={pendiente} className={CTA}>
                {pendiente ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                {look.compartido ? "Reenviar el look al cliente" : "Enviar el look al cliente"}
              </button>
              <p className="text-center text-xs text-muted-foreground">Le llega por WhatsApp (o correo) un enlace con sus vistas y cómo pedir el corte igual.</p>
              {enlace && (
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(enlace).then(() => toast({ tone: "success", message: "Enlace copiado" }))}
                  className={`${SECUNDARIO} w-full`}
                >
                  <Copy size={15} aria-hidden="true" /> Copiar enlace
                </button>
              )}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">El servicio se cobra en “Servicios”, más abajo; queda en la caja.</p>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Historial
// ---------------------------------------------------------------------------

const ESTADO_LOOK: Record<string, { etiqueta: string; tono: "neutral" | "info" | "success" | "warning" }> = {
  capturado: { etiqueta: "Foto", tono: "neutral" },
  analizado: { etiqueta: "Propuestas", tono: "info" },
  aprobado: { etiqueta: "Aprobado", tono: "warning" },
  realizado: { etiqueta: "Realizado", tono: "success" },
  descartado: { etiqueta: "Descartado", tono: "neutral" },
};

function Historial({ looks, actual, onAbrir, cuentaId }: { looks: LookFicha[]; actual: string | null; onAbrir: (id: string) => void; cuentaId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pendiente, iniciar] = useTransition();
  const [confirmar, setConfirmar] = useState(false);
  const visibles = useMemo(() => looks.filter((look) => look.estado !== "descartado").slice(0, 8), [looks]);
  const actualLook = looks.find((look) => look.id === actual) ?? null;

  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      {visibles.length > 1 ? (
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          <span className="flex-shrink-0 text-xs text-muted-foreground">Looks:</span>
          {visibles.map((look) => {
            const aprobada = look.propuestas.find((propuesta) => propuesta.id === look.propuestaAprobada);
            return (
              <button
                key={look.id}
                type="button"
                onClick={() => onAbrir(look.id)}
                className={`flex h-9 flex-shrink-0 items-center gap-2 rounded-full border pl-1 pr-3 text-xs transition-colors ${actual === look.id ? "border-primary bg-primary/5" : "border-border hover:bg-surface-muted"}`}
              >
                <span className="size-7 overflow-hidden rounded-full bg-surface-muted">
                  {(aprobada?.vistas.frontal ?? look.foto) && (
                    // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado
                    <img src={aprobada?.vistas.frontal ?? look.foto ?? ""} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                {fecha.format(new Date(look.created_at))}
                <Badge tone={ESTADO_LOOK[look.estado].tono}>{aprobada?.nombre ?? ESTADO_LOOK[look.estado].etiqueta}</Badge>
              </button>
            );
          })}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">Las fotos originales se borran solas a los 90 días.</span>
      )}
      <div className="flex flex-shrink-0 items-center gap-3 text-xs">
        {actualLook && actualLook.estado !== "realizado" && (
          <button
            type="button"
            disabled={pendiente}
            onClick={() =>
              iniciar(async () => {
                const resultado = await descartarLook(actualLook.id);
                if (!resultado.ok) toast({ tone: "danger", message: resultado.error });
                router.refresh();
              })
            }
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            Descartar este look
          </button>
        )}
        {confirmar ? (
          <span className="flex items-center gap-2">
            <span className="text-danger">¿Borrar todas sus fotos?</span>
            <button
              type="button"
              disabled={pendiente}
              onClick={() =>
                iniciar(async () => {
                  const resultado = await revocarConsentimiento(cuentaId);
                  if (!resultado.ok) toast({ tone: "danger", message: resultado.error });
                  else toast({ tone: "success", message: `Autorización retirada · ${resultado.borradas} fotos borradas` });
                  setConfirmar(false);
                  router.refresh();
                })
              }
              className="font-medium text-danger hover:underline"
            >
              Sí, borrar
            </button>
            <button type="button" onClick={() => setConfirmar(false)} className="text-muted-foreground hover:underline">
              No
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmar(true)} className="inline-flex items-center gap-1 text-muted-foreground hover:text-danger">
            <Trash2 size={12} aria-hidden="true" /> Retirar autorización de fotos
          </button>
        )}
      </div>
    </div>
  );
}
