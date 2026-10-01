"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
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
import { alinearConAntes, prepararDetector } from "@/components/barber/alinear-antes";
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
 * facciones, propuestas simuladas sobre la foto, mapa de corte por zona y el
 * resultado para comparar con la expectativa. Cada paso tiene una sola acción
 * principal. Lo lento corre solo y en paralelo: al guardar la foto parten el
 * retrato de estudio y el análisis; apenas hay propuestas, se simula el frente
 * de todas, así cambiar de corte es inmediato.
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
  const [retratos, setRetratos] = useState<Record<string, string>>({});
  const [preparandoRetrato, setPreparandoRetrato] = useState<Set<string>>(new Set());
  const retratosEnCurso = useRef(new Map<string, Promise<void>>());
  const [generadas, setGeneradas] = useState<Record<string, Partial<Record<VistaLook, string>>>>({});
  const [generando, setGenerando] = useState<Set<string>>(new Set());

  /** Simula vistas de una propuesta, en paralelo; cada una aparece apenas llega. */
  const simular = async (idLook: string, propuestaId: string, vistas: VistaLook[]) => {
    const claves = vistas.map((vista) => `${propuestaId}:${vista}`);
    setGenerando((actual) => new Set([...actual, ...claves]));
    // El frente edita el retrato del "antes" para calzar su encuadre: si todavía se está haciendo, se espera.
    if (vistas.includes("frontal")) await retratosEnCurso.current.get(idLook);
    const fallas: string[] = [];
    await Promise.all(
      vistas.map(async (vista) => {
        try {
          const respuesta = await fetch(`/api/looks/${idLook}/vistas`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ propuesta: propuestaId, vista }),
          });
          const datos = (await respuesta.json().catch(() => ({}))) as { url?: string; error?: string };
          if (!respuesta.ok || !datos.url) throw new Error(datos.error ?? "Falló una vista.");
          setGeneradas((actual) => ({ ...actual, [propuestaId]: { ...(actual[propuestaId] ?? {}), [vista]: datos.url } }));
        } catch (error) {
          fallas.push(error instanceof Error ? error.message : "Falló una vista.");
        } finally {
          setGenerando((actual) => {
            const siguiente = new Set(actual);
            siguiente.delete(`${propuestaId}:${vista}`);
            return siguiente;
          });
        }
      }),
    );
    return fallas;
  };

  /** Apenas hay propuestas: el frente de todas a la vez. */
  const previsualizar = async (idLook: string, ids: string[]) => {
    if (!ia.simulacion || ids.length === 0) return;
    const fallas = (await Promise.all(ids.map((id) => simular(idLook, id, ["frontal"])))).flat();
    if (fallas.length === ids.length) toast({ tone: "danger", message: fallas[0] });
  };

  /** El "antes" como retrato de estudio, con el encuadre de las simulaciones. */
  const pedirRetrato = (idLook: string) => {
    if (!ia.simulacion) return;
    setPreparandoRetrato((actual) => new Set([...actual, idLook]));
    const enCurso = (async () => {
      try {
        const respuesta = await fetch(`/api/looks/${idLook}/retrato`, { method: "POST" });
        const datos = (await respuesta.json().catch(() => ({}))) as { url?: string; error?: string };
        if (respuesta.ok && datos.url) setRetratos((actual) => ({ ...actual, [idLook]: datos.url as string }));
      } catch {
        // Sin retrato, el antes es la foto original y el comparador igual alinea.
      } finally {
        retratosEnCurso.current.delete(idLook);
        setPreparandoRetrato((actual) => {
          const siguiente = new Set(actual);
          siguiente.delete(idLook);
          return siguiente;
        });
      }
    })();
    retratosEnCurso.current.set(idLook, enCurso);
  };

  /** El análisis corre en segundo plano; al terminar, parten las simulaciones de frente. */
  const analizar = async (id: string) => {
    setAnalizando(id);
    let ids: string[] = [];
    try {
      const respuesta = await fetch(`/api/looks/${id}/analizar`, { method: "POST" });
      const datos = (await respuesta.json().catch(() => ({}))) as { error?: string; fotoUtil?: boolean; problema?: string; ids?: string[] };
      if (!respuesta.ok) throw new Error(datos.error ?? "El análisis falló.");
      if (datos.fotoUtil === false) toast({ tone: "danger", message: datos.problema || "La foto no sirve para analizar. Toma otra." });
      else {
        toast({ tone: "success", message: "Análisis listo: simulando los cortes" });
        ids = datos.ids ?? [];
        setPasoElegido({ look: id, paso: "propuestas" });
      }
    } catch (error) {
      toast({ tone: "danger", message: error instanceof Error ? error.message : "El análisis falló." });
    } finally {
      setAnalizando(null);
      router.refresh();
    }
    await previsualizar(id, ids);
    router.refresh();
  };

  const simulacion = { generadas, generando, simular, previsualizar };

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
            // Apenas está la foto: el retrato de estudio y el análisis parten solos, en paralelo.
            pedirRetrato(id);
            if (ia.analisis) void analizar(id);
          }}
        />
      ) : paso === "analisis" ? (
        <PasoAnalisis
          key={`analisis-${look.id}`}
          look={look}
          ia={ia}
          retrato={retratos[look.id] ?? look.retrato}
          preparandoRetrato={preparandoRetrato.has(look.id)}
          analizando={analizando === look.id}
          onAnalizar={() => void analizar(look.id)}
          onPropuestas={(ids) => {
            irA("propuestas");
            void previsualizar(look.id, ids).then(() => router.refresh());
          }}
          onListo={() => irA("propuestas")}
        />
      ) : paso === "propuestas" ? (
        <PasoPropuestas key={`propuestas-${look.id}`} look={look} ia={ia} nombre={nombre} antes={retratos[look.id] ?? look.retrato ?? look.foto} simulacion={simulacion} onAprobado={() => irA("mapa")} />
      ) : paso === "mapa" ? (
        <PasoMapa key={`mapa-${look.id}`} cuentaId={cuentaId} look={look} guardados={mapasDelLook} ultimo={mapas[0] ?? null} barberos={barberos} onGuardado={() => irA("resultado")} />
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
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${
                  cual === opcion ? "bg-surface text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
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
                  className="min-h-9 rounded-lg px-2.5 text-[13px] font-medium text-muted-foreground ring-1 ring-border transition-colors hover:bg-surface-muted hover:text-foreground"
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
  retrato,
  preparandoRetrato,
  analizando,
  onAnalizar,
  onPropuestas,
  onListo,
}: {
  look: LookFicha;
  ia: IaDisponible;
  retrato: string | null;
  preparandoRetrato: boolean;
  analizando: boolean;
  onAnalizar: () => void;
  onPropuestas: (ids: string[]) => void;
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
      toast({ tone: "success", message: `${resultado.propuestas} cortes propuestos: simulándolos` });
      router.refresh();
      onPropuestas(resultado.ids);
    });

  return (
    <Diseno
      escenario={
        <Escenario>
          {retrato || look.foto ? (
            // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado o del editor
            <img src={retrato ?? look.foto ?? ""} alt="El cliente hoy" className={`h-full w-full object-contain transition-opacity duration-500 ${preparandoRetrato && !retrato ? "opacity-60" : ""}`} />
          ) : (
            <SinFoto />
          )}
          {preparandoRetrato && !retrato && !analizando && (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-6 pb-10 pt-4 text-xs text-white">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Preparando el retrato de estudio…
            </div>
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

type Simulacion = {
  generadas: Record<string, Partial<Record<VistaLook, string>>>;
  generando: Set<string>;
  simular: (idLook: string, propuestaId: string, vistas: VistaLook[]) => Promise<string[]>;
  previsualizar: (idLook: string, ids: string[]) => Promise<void>;
};

function PasoPropuestas({
  look,
  ia,
  nombre,
  antes,
  simulacion,
  onAprobado,
}: {
  look: LookFicha;
  ia: IaDisponible;
  nombre: string;
  antes: string | null;
  simulacion: Simulacion;
  onAprobado: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [elegida, setElegida] = useState<string | null>(look.propuestaAprobada ?? look.propuestas[0]?.id ?? null);
  const propuesta = look.propuestas.find((candidata) => candidata.id === elegida) ?? look.propuestas[0] ?? null;
  const [vista, setVista] = useState<VistaLook>("frontal");
  const [comparar, setComparar] = useState(50);
  const [catalogo, setCatalogo] = useState({ corte: CATALOGO_CORTES[0].id, barba: "sin_barba" as EstiloBarba });
  const [pendiente, iniciar] = useTransition();
  // El detector de rostro tarda en bajar la primera vez: se prepara apenas se abre el paso, no al comparar.
  useEffect(() => {
    if (ia.simulacion) void prepararDetector().catch(() => undefined);
  }, [ia.simulacion]);

  const vistasDe = (objetivo: PropuestaLook) => ({ ...objetivo.vistas, ...(simulacion.generadas[objetivo.id] ?? {}) });
  const cargando = (objetivo: PropuestaLook, opcion: VistaLook) => simulacion.generando.has(`${objetivo.id}:${opcion}`);
  const vistas = propuesta ? vistasDe(propuesta) : {};
  const faltan = propuesta ? VISTAS_LOOK.filter((opcion) => !vistas[opcion] && !cargando(propuesta, opcion)) : [];

  const pedir = async (objetivo: PropuestaLook, cuales: VistaLook[]) => {
    const fallas = await simulacion.simular(look.id, objetivo.id, cuales);
    if (fallas.length > 0) toast({ tone: "danger", message: fallas.length === cuales.length ? fallas[0] : `${fallas.length} de ${cuales.length} vistas fallaron; puedes reintentarlas.` });
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
      setVista("frontal");
      router.refresh();
      if (ia.simulacion) void pedir({ id: resultado.id, vistas: {} } as PropuestaLook, ["frontal"]);
    });

  if (look.propuestas.length === 0) {
    return <div className="p-6 text-center text-sm text-muted-foreground">Todavía no hay propuestas. Vuelve al paso de análisis para que la IA o el catálogo propongan cortes.</div>;
  }

  const actual = vistas[vista];
  const simulandoActual = propuesta ? cargando(propuesta, vista) : false;

  return (
    <Diseno
      escenario={
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{propuesta?.nombre}</p>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Ángulo">
              {VISTAS_LOOK.map((opcion) => (
                <button
                  key={opcion}
                  type="button"
                  role="tab"
                  aria-selected={vista === opcion}
                  onClick={() => {
                    setVista(opcion);
                    if (propuesta && ia.simulacion && !vistas[opcion] && !cargando(propuesta, opcion)) void pedir(propuesta, [opcion]);
                  }}
                  className={`h-9 rounded-md px-3 text-xs transition-colors ${vista === opcion ? "bg-foreground text-background" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"}`}
                >
                  {INFO_VISTA[opcion].nombre}
                </button>
              ))}
            </div>
          </div>
          <Escenario>
            {actual ? (
              <Comparador antes={vista === "frontal" ? antes : null} despues={actual} posicion={vista === "frontal" ? comparar : 100} onPosicion={setComparar} />
            ) : (
              <div className="relative h-full w-full">
                {antes && (
                  // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado
                  <img src={antes} alt="" className={`absolute inset-0 h-full w-full object-contain ${simulandoActual ? "animate-pulse opacity-50" : "opacity-35"}`} />
                )}
                <div className="relative flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                  {simulandoActual ? (
                    <p className="flex items-center gap-2 rounded-full bg-black/55 px-4 py-2 text-sm font-medium text-white backdrop-blur">
                      <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Simulando {INFO_VISTA[vista].nombre.toLowerCase()}…
                    </p>
                  ) : ia.simulacion && propuesta ? (
                    <button
                      type="button"
                      onClick={() => void pedir(propuesta, [vista])}
                      className="inline-flex h-11 items-center gap-2 rounded-full border border-[#e0b36e] bg-black/40 px-5 text-sm font-semibold text-[#e0b36e] backdrop-blur hover:bg-black/55"
                    >
                      <Sparkles size={16} aria-hidden="true" /> Simular {INFO_VISTA[vista].nombre.toLowerCase()}
                    </button>
                  ) : (
                    <p className="max-w-sm rounded-xl bg-black/55 px-4 py-3 text-sm text-white/90 backdrop-blur">La simulación en foto no está activa en esta barbería. La ficha de cada corte sigue disponible.</p>
                  )}
                </div>
              </div>
            )}
          </Escenario>
          {propuesta && (
            <div className="grid grid-cols-5 gap-2">
              <Miniatura url={antes} etiqueta="Antes" activa={false} onClick={() => setVista("frontal")} />
              {VISTAS_LOOK.map((opcion) => (
                <Miniatura
                  key={opcion}
                  url={vistas[opcion] ?? null}
                  cargando={cargando(propuesta, opcion)}
                  etiqueta={INFO_VISTA[opcion].nombre}
                  activa={vista === opcion}
                  onClick={() => {
                    setVista(opcion);
                    if (ia.simulacion && !vistas[opcion] && !cargando(propuesta, opcion)) void pedir(propuesta, [opcion]);
                  }}
                />
              ))}
            </div>
          )}
          {propuesta && ia.simulacion && faltan.length > 1 && (
            <button type="button" onClick={() => void pedir(propuesta, faltan)} className="text-sm text-primary hover:underline">
              Simular los {faltan.length} ángulos que faltan
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
              const frente = vistasDe(opcion).frontal;
              return (
                <li key={opcion.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setElegida(opcion.id);
                      setVista("frontal");
                      if (ia.simulacion && !frente && !cargando(opcion, "frontal")) void pedir(opcion, ["frontal"]);
                    }}
                    className={`flex w-full gap-3 rounded-xl border p-2.5 text-left transition-colors ${activa ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/50"}`}
                  >
                    <span className="relative h-20 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-[#1a1714]">
                      {frente ? (
                        // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado o del editor
                        <img src={frente} alt="" className="h-full w-full object-cover" />
                      ) : cargando(opcion, "frontal") ? (
                        <span className="flex h-full items-center justify-center">
                          <Loader2 size={14} className="animate-spin text-white/60" aria-hidden="true" />
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          <span className="mr-1.5 tabular-nums text-muted-foreground">{indice + 1}.</span>
                          {opcion.nombre}
                        </span>
                        <span className="flex flex-shrink-0 gap-1">
                          {aprobada && <Badge tone="success">Aprobado</Badge>}
                          <Badge tone="neutral">{opcion.origen === "ia" ? "IA" : opcion.origen === "reglas" ? "Catálogo" : "Barbero"}</Badge>
                        </span>
                      </span>
                      {activa ? (
                        <span className="mt-1.5 block space-y-1 text-sm">
                          <span className="block text-muted-foreground">{opcion.por_que}</span>
                          {opcion.que_decirle && <span className="block text-foreground">“{opcion.que_decirle}”</span>}
                          <span className="block text-xs text-muted-foreground">
                            Mantención cada {opcion.mantencion_semanas} semanas · dificultad {opcion.dificultad}
                            {opcion.barba ? ` · ${opcion.barba.toLowerCase()}` : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="mt-1 block truncate text-xs text-muted-foreground">Mantención cada {opcion.mantencion_semanas} semanas</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {propuesta && (
            <button type="button" onClick={aprobar} disabled={pendiente || look.propuestaAprobada === propuesta.id} className={CTA}>
              {pendiente ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
              {look.propuestaAprobada === propuesta.id ? `${nombre} ya aprobó este look` : "Aprobar este look"}
            </button>
          )}

          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium text-foreground">Probar otro corte del catálogo</summary>
            <div className="mt-3 space-y-2">
              <SelectorFaccion etiqueta="Corte" valor={catalogo.corte} opciones={CATALOGO_CORTES.map((corte) => [corte.id, corte.nombre])} onChange={(corte) => setCatalogo({ ...catalogo, corte })} />
              <SelectorFaccion etiqueta="Barba" valor={catalogo.barba} opciones={ESTILOS_BARBA.map((barba) => [barba.id, barba.nombre])} onChange={(barba) => setCatalogo({ ...catalogo, barba: barba as EstiloBarba })} />
              <button type="button" onClick={agregar} disabled={pendiente} className={`${SECUNDARIO} w-full`}>
                <Plus size={16} aria-hidden="true" /> Agregar y simular
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

/**
 * Antes y después sobre la misma foto: se arrastra la línea. Las dos imágenes
 * se alinean por los puntos de la cara antes de partirlas; mientras tanto, o
 * si no se puede, se ve solo la simulación. Nunca un rostro descuadrado.
 */
function Comparador({ antes, despues, posicion, onPosicion }: { antes: string | null; despues: string; posicion: number; onPosicion: (valor: number) => void }) {
  const comparando = Boolean(antes) && posicion < 100;
  const clave = comparando ? `${antes}\n${despues}` : null;
  const [alineado, setAlineado] = useState<{ clave: string; par: { antes: string; despues: string } | null } | null>(null);
  useEffect(() => {
    if (!clave || !antes) return;
    let vigente = true;
    void alinearConAntes(antes, despues).then((par) => {
      if (vigente) setAlineado({ clave, par });
    });
    return () => {
      vigente = false;
    };
  }, [clave, antes, despues]);
  // undefined: alineando; null: no se pudo alinear.
  const par = clave && alineado?.clave === clave ? alineado.par : undefined;

  return (
    <div className="relative h-full w-full select-none">
      {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado o imagen local ya alineada */}
      <img src={par?.despues ?? despues} alt="Simulación" className="absolute inset-0 h-full w-full object-contain" />
      {comparando && par && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagen local ya alineada */}
          <img src={par.antes} alt="Antes" className="absolute inset-0 h-full w-full object-contain" style={{ clipPath: `inset(0 ${100 - posicion}% 0 0)` }} />
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
      {comparando && !par && (
        <p className="pointer-events-none absolute inset-x-0 bottom-4 mx-auto flex w-fit items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs text-white backdrop-blur" role="status">
          {par === undefined ? (
            <>
              <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Alineando el antes con la simulación…
            </>
          ) : (
            "No se pudo alinear el rostro: se muestra solo la simulación"
          )}
        </p>
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
  guardados,
  ultimo,
  barberos,
  onGuardado,
}: {
  cuentaId: string;
  look: LookFicha;
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
  const angulos = aprobada ? VISTAS_LOOK.filter((opcion) => aprobada.vistas[opcion]) : [];
  const [angulo, setAngulo] = useState<VistaLook>(angulos.includes("perfil") ? "perfil" : (angulos[0] ?? "frontal"));
  const referencia = aprobada?.vistas[angulo] ?? null;
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
          {angulos.length > 1 && (
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Ángulo">
              {angulos.map((opcion) => (
                <button
                  key={opcion}
                  type="button"
                  role="tab"
                  aria-selected={angulo === opcion}
                  onClick={() => setAngulo(opcion)}
                  className={`h-9 rounded-md px-3 text-xs transition-colors ${angulo === opcion ? "bg-foreground text-background" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"}`}
                >
                  {INFO_VISTA[opcion].nombre}
                </button>
              ))}
            </div>
          )}
          <Escenario>
            {referencia || look.foto ? (
              // eslint-disable-next-line @next/next/no-img-element -- enlace firmado del bucket privado
              <img src={referencia ?? look.foto ?? ""} alt={aprobada ? `${aprobada.nombre}, ${INFO_VISTA[angulo].nombre.toLowerCase()}` : "Foto del cliente"} className="h-full w-full object-contain" />
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
                className={`flex h-9 flex-shrink-0 items-center gap-2 rounded-lg pl-1 pr-2.5 text-[13px] font-medium transition-colors ${actual === look.id ? "bg-surface text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"}`}
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
