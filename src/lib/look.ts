/**
 * Estudio de Look: el vocabulario del corte. Puro, para servidor y cliente.
 *
 * Un corte se describe como lo describe un barbero: por zona de la cabeza,
 * cuántos milímetros quedan y con qué se corta. Ese "mapa de corte" es lo que
 * dibuja la cabeza 3D, lo que la IA propone, lo que el barbero corrige y lo
 * que queda en la historia del cliente para repetir el corte igual.
 */

export const ZONAS = [
  "flequillo",
  "superior",
  "coronilla",
  "lateral_alto",
  "lateral_bajo",
  "nuca_alta",
  "nuca_baja",
  "patillas",
  "barba_mejillas",
  "bigote",
  "menton",
] as const;
export type Zona = (typeof ZONAS)[number];

export const INFO_ZONA: Record<Zona, { nombre: string; corto: string; grupo: "pelo" | "barba" }> = {
  flequillo: { nombre: "Flequillo y frente", corto: "Flequillo", grupo: "pelo" },
  superior: { nombre: "Parte superior", corto: "Arriba", grupo: "pelo" },
  coronilla: { nombre: "Coronilla", corto: "Coronilla", grupo: "pelo" },
  lateral_alto: { nombre: "Laterales altos", corto: "Lat. altos", grupo: "pelo" },
  lateral_bajo: { nombre: "Laterales bajos", corto: "Lat. bajos", grupo: "pelo" },
  nuca_alta: { nombre: "Nuca alta", corto: "Nuca alta", grupo: "pelo" },
  nuca_baja: { nombre: "Nuca baja", corto: "Nuca baja", grupo: "pelo" },
  patillas: { nombre: "Patillas", corto: "Patillas", grupo: "pelo" },
  barba_mejillas: { nombre: "Barba en mejillas", corto: "Mejillas", grupo: "barba" },
  bigote: { nombre: "Bigote", corto: "Bigote", grupo: "barba" },
  menton: { nombre: "Mentón y cuello", corto: "Mentón", grupo: "barba" },
};

export const TECNICAS = ["maquina", "degradado", "tijera", "texturizado", "navaja", "sin_cortar"] as const;
export type Tecnica = (typeof TECNICAS)[number];

export const INFO_TECNICA: Record<Tecnica, string> = {
  maquina: "Máquina",
  degradado: "Degradado",
  tijera: "Tijera",
  texturizado: "Texturizado",
  navaja: "Navaja",
  sin_cortar: "Sin cortar",
};

/** Las guardas de la máquina, en milímetros. Sobre la N.º 8 se corta a tijera. */
export const GUARDAS = [
  { id: "0", nombre: "Al cero", mm: 0.5 },
  { id: "0.5", nombre: "N.º 0,5", mm: 1.5 },
  { id: "1", nombre: "N.º 1", mm: 3 },
  { id: "1.5", nombre: "N.º 1,5", mm: 4.5 },
  { id: "2", nombre: "N.º 2", mm: 6 },
  { id: "3", nombre: "N.º 3", mm: 10 },
  { id: "4", nombre: "N.º 4", mm: 13 },
  { id: "5", nombre: "N.º 5", mm: 16 },
  { id: "6", nombre: "N.º 6", mm: 19 },
  { id: "7", nombre: "N.º 7", mm: 22 },
  { id: "8", nombre: "N.º 8", mm: 25 },
] as const;

export const MM_MAXIMO = 150;

const mmTexto = (mm: number) => `${Number.isInteger(mm) ? mm : mm.toLocaleString("es-CL", { maximumFractionDigits: 1 })} mm`;

/** "N.º 2 · 6 mm", "Tijera · 45 mm", "Sin pelo". */
export function etiquetaLargo(mm: number, tecnica?: Tecnica): string {
  if (mm <= 0) return "Sin pelo";
  if (tecnica === "navaja" && mm <= 0.5) return "A navaja";
  const guarda = guardaCercana(mm);
  if (guarda && Math.abs(guarda.mm - mm) <= 0.75) return `${guarda.nombre} · ${mmTexto(mm)}`;
  return `${tecnica && tecnica !== "maquina" && tecnica !== "degradado" ? INFO_TECNICA[tecnica] : "Tijera"} · ${mmTexto(mm)}`;
}

export function guardaCercana(mm: number) {
  if (mm > 26) return null;
  return GUARDAS.reduce((mejor, guarda) => (Math.abs(guarda.mm - mm) < Math.abs(mejor.mm - mm) ? guarda : mejor), GUARDAS[0]);
}

export type LargoDeZona = { mm: number; tecnica: Tecnica };
export type MapaCorte = Record<Zona, LargoDeZona>;

/** Normaliza lo que venga (IA, formulario, base) a un mapa completo y dentro de rango. */
export function normalizarMapa(entrada: unknown, base: MapaCorte = MAPA_NEUTRO): MapaCorte {
  const origen = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;
  const salida = {} as MapaCorte;
  for (const zona of ZONAS) {
    const valor = (origen[zona] && typeof origen[zona] === "object" ? origen[zona] : {}) as Record<string, unknown>;
    const mm = Number(valor.mm);
    const tecnica = String(valor.tecnica ?? "");
    salida[zona] = {
      mm: Number.isFinite(mm) ? Math.round(Math.min(MM_MAXIMO, Math.max(0, mm)) * 2) / 2 : base[zona].mm,
      tecnica: (TECNICAS as readonly string[]).includes(tecnica) ? (tecnica as Tecnica) : base[zona].tecnica,
    };
  }
  return salida;
}

function mapa(valores: Partial<Record<Zona, readonly [number, Tecnica]>>, base: MapaCorte): MapaCorte {
  const salida = { ...base };
  for (const [zona, [mm, tecnica]] of Object.entries(valores) as [Zona, readonly [number, Tecnica]][]) salida[zona] = { mm, tecnica };
  return salida;
}

/** Pelo mediano parejo, sin barba: el punto de partida cuando no hay nada. */
export const MAPA_NEUTRO: MapaCorte = {
  flequillo: { mm: 40, tecnica: "tijera" },
  superior: { mm: 45, tecnica: "tijera" },
  coronilla: { mm: 35, tecnica: "tijera" },
  lateral_alto: { mm: 22, tecnica: "tijera" },
  lateral_bajo: { mm: 16, tecnica: "maquina" },
  nuca_alta: { mm: 20, tecnica: "tijera" },
  nuca_baja: { mm: 12, tecnica: "maquina" },
  patillas: { mm: 10, tecnica: "maquina" },
  barba_mejillas: { mm: 0, tecnica: "navaja" },
  bigote: { mm: 0, tecnica: "navaja" },
  menton: { mm: 0, tecnica: "navaja" },
};

export const FORMAS_ROSTRO = ["ovalado", "redondo", "cuadrado", "alargado", "corazon", "diamante", "triangular"] as const;
export type FormaRostro = (typeof FORMAS_ROSTRO)[number];
export const INFO_FORMA: Record<FormaRostro, { nombre: string; claves: string }> = {
  ovalado: { nombre: "Ovalado", claves: "Proporcionado; casi todo le queda bien." },
  redondo: { nombre: "Redondo", claves: "Ancho y largo parecidos, mandíbula suave: sumar altura arriba y despejar los lados." },
  cuadrado: { nombre: "Cuadrado", claves: "Mandíbula marcada: suavizar con textura o aprovecharla con laterales cortos." },
  alargado: { nombre: "Alargado", claves: "Más largo que ancho: evitar volumen alto, dejar algo de ancho a los lados o flequillo." },
  corazon: { nombre: "Corazón", claves: "Frente ancha y mentón fino: flequillo o laterales con algo de largo; la barba equilibra." },
  diamante: { nombre: "Diamante", claves: "Pómulos anchos: textura arriba y laterales no tan cortos, flequillo suaviza." },
  triangular: { nombre: "Triangular", claves: "Mandíbula más ancha que la frente: volumen arriba y laterales al ras." },
};

export const TIPOS_PELO = ["liso", "ondulado", "rizado", "afro"] as const;
export type TipoPelo = (typeof TIPOS_PELO)[number];
export const INFO_PELO: Record<TipoPelo, string> = { liso: "Liso", ondulado: "Ondulado", rizado: "Rizado", afro: "Afro" };

export const DENSIDADES = ["baja", "media", "alta"] as const;
export type Densidad = (typeof DENSIDADES)[number];

export const ENTRADAS = ["no", "leves", "marcadas"] as const;
export type Entradas = (typeof ENTRADAS)[number];

export type CorteCatalogo = {
  id: string;
  nombre: string;
  descripcion: string;
  mapa: MapaCorte;
  favorece: FormaRostro[];
  evita: FormaRostro[];
  pelos: TipoPelo[];
  /** Semanas hasta que pierde la forma. */
  mantencion: number;
  /** Para disimular entradas o poca densidad. */
  disimulaEntradas: boolean;
  /** Cómo se ve, en inglés: es lo que recibe el modelo de imagen. */
  visual: string;
};

const SIN_BARBA = { barba_mejillas: [0, "navaja"], bigote: [0, "navaja"], menton: [0, "navaja"] } as const;

export const CATALOGO_CORTES: CorteCatalogo[] = [
  {
    id: "mid_fade_crop",
    nombre: "Mid fade con crop texturizado",
    descripcion: "Degradado medio y arriba corto con textura hacia adelante. Moderno, fácil de peinar.",
    mapa: mapa({ flequillo: [30, "texturizado"], superior: [35, "texturizado"], coronilla: [30, "texturizado"], lateral_alto: [6, "degradado"], lateral_bajo: [1.5, "degradado"], nuca_alta: [6, "degradado"], nuca_baja: [1.5, "degradado"], patillas: [3, "degradado"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["ovalado", "cuadrado", "alargado", "diamante"],
    evita: [],
    pelos: ["liso", "ondulado", "rizado"],
    mantencion: 3,
    disimulaEntradas: true,
    visual: "a modern textured French crop on top (about 3 cm, choppy texture pushed forward) with a clean mid skin fade on the sides and back",
  },
  {
    id: "skin_fade_quiff",
    nombre: "Skin fade con quiff",
    descripcion: "Laterales a piel y volumen arriba peinado hacia arriba y atrás. Da altura.",
    mapa: mapa({ flequillo: [70, "tijera"], superior: [60, "tijera"], coronilla: [40, "tijera"], lateral_alto: [4.5, "degradado"], lateral_bajo: [0.5, "degradado"], nuca_alta: [4.5, "degradado"], nuca_baja: [0.5, "degradado"], patillas: [1.5, "degradado"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["redondo", "ovalado", "cuadrado", "triangular"],
    evita: ["alargado"],
    pelos: ["liso", "ondulado"],
    mantencion: 3,
    disimulaEntradas: false,
    visual: "a voluminous quiff (6-7 cm on top, styled up and back) with a high skin fade on the sides and back",
  },
  {
    id: "taper_clasico",
    nombre: "Taper clásico con raya al lado",
    descripcion: "Degradado suave solo en patillas y nuca, arriba largo de tijera con raya. Sobrio y de oficina.",
    mapa: mapa({ flequillo: [55, "tijera"], superior: [55, "tijera"], coronilla: [40, "tijera"], lateral_alto: [19, "tijera"], lateral_bajo: [10, "degradado"], nuca_alta: [16, "tijera"], nuca_baja: [4.5, "degradado"], patillas: [6, "degradado"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["ovalado", "cuadrado", "alargado", "corazon", "diamante"],
    evita: [],
    pelos: ["liso", "ondulado"],
    mantencion: 5,
    disimulaEntradas: true,
    visual: "a classic gentleman's side-part haircut, scissor cut on top (about 5 cm) combed to the side, with a subtle low taper at the sideburns and neckline",
  },
  {
    id: "buzz_fade",
    nombre: "Buzz cut con fade",
    descripcion: "Todo corto parejo y degradado a piel abajo. Cero mantención diaria.",
    mapa: mapa({ flequillo: [6, "maquina"], superior: [6, "maquina"], coronilla: [6, "maquina"], lateral_alto: [3, "degradado"], lateral_bajo: [0.5, "degradado"], nuca_alta: [3, "degradado"], nuca_baja: [0.5, "degradado"], patillas: [1.5, "degradado"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["ovalado", "cuadrado", "diamante"],
    evita: ["redondo", "alargado"],
    pelos: ["liso", "ondulado", "rizado", "afro"],
    mantencion: 2,
    disimulaEntradas: true,
    visual: "a very short buzz cut (about 6 mm all over the top) with a skin fade on the sides and back",
  },
  {
    id: "french_crop",
    nombre: "French crop clásico",
    descripcion: "Flequillo recto corto y laterales con degradado bajo. Acorta visualmente la cara.",
    mapa: mapa({ flequillo: [25, "tijera"], superior: [30, "texturizado"], coronilla: [25, "texturizado"], lateral_alto: [10, "degradado"], lateral_bajo: [3, "degradado"], nuca_alta: [10, "degradado"], nuca_baja: [3, "degradado"], patillas: [4.5, "degradado"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["alargado", "corazon", "diamante", "ovalado"],
    evita: ["redondo"],
    pelos: ["liso", "ondulado"],
    mantencion: 4,
    disimulaEntradas: true,
    visual: "a classic French crop with a short straight fringe over the forehead and a low fade on the sides",
  },
  {
    id: "slick_back_undercut",
    nombre: "Undercut peinado hacia atrás",
    descripcion: "Laterales cortos marcados y arriba largo peinado hacia atrás con producto.",
    mapa: mapa({ flequillo: [110, "tijera"], superior: [100, "tijera"], coronilla: [70, "tijera"], lateral_alto: [6, "maquina"], lateral_bajo: [6, "maquina"], nuca_alta: [6, "maquina"], nuca_baja: [3, "maquina"], patillas: [6, "maquina"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["ovalado", "redondo", "cuadrado", "triangular"],
    evita: ["alargado"],
    pelos: ["liso", "ondulado"],
    mantencion: 4,
    disimulaEntradas: false,
    visual: "a disconnected undercut with long hair on top (about 10 cm) slicked straight back with a glossy finish, sides clipped short",
  },
  {
    id: "mullet_moderno",
    nombre: "Mullet moderno",
    descripcion: "Laterales con burst fade y largo atrás. Estilo marcado y juvenil.",
    mapa: mapa({ flequillo: [45, "texturizado"], superior: [45, "texturizado"], coronilla: [50, "texturizado"], lateral_alto: [6, "degradado"], lateral_bajo: [0.5, "degradado"], nuca_alta: [70, "tijera"], nuca_baja: [80, "tijera"], patillas: [1.5, "degradado"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["ovalado", "cuadrado", "diamante"],
    evita: ["redondo"],
    pelos: ["ondulado", "rizado", "liso"],
    mantencion: 5,
    disimulaEntradas: false,
    visual: "a modern mullet with a burst fade around the ears, textured top, and longer flowing hair at the back of the neck",
  },
  {
    id: "burst_fade_rizos",
    nombre: "Burst fade con rizos arriba",
    descripcion: "Degradado en semicírculo alrededor de la oreja y los rizos definidos arriba.",
    mapa: mapa({ flequillo: [45, "tijera"], superior: [50, "tijera"], coronilla: [45, "tijera"], lateral_alto: [6, "degradado"], lateral_bajo: [0.5, "degradado"], nuca_alta: [20, "tijera"], nuca_baja: [6, "degradado"], patillas: [1.5, "degradado"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["ovalado", "redondo", "cuadrado", "alargado", "triangular"],
    evita: [],
    pelos: ["rizado", "afro", "ondulado"],
    mantencion: 3,
    disimulaEntradas: false,
    visual: "defined natural curls on top (about 5 cm) with a burst fade curving around the ears",
  },
  {
    id: "drop_fade_afro",
    nombre: "Drop fade con afro corto",
    descripcion: "Volumen redondeado arriba y degradado que baja detrás de la oreja.",
    mapa: mapa({ flequillo: [35, "tijera"], superior: [40, "tijera"], coronilla: [40, "tijera"], lateral_alto: [10, "degradado"], lateral_bajo: [0.5, "degradado"], nuca_alta: [10, "degradado"], nuca_baja: [0.5, "degradado"], patillas: [3, "degradado"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["ovalado", "alargado", "corazon", "diamante"],
    evita: [],
    pelos: ["afro", "rizado"],
    mantencion: 3,
    disimulaEntradas: false,
    visual: "a short rounded afro on top (about 4 cm, sponge-twisted texture) with a drop fade dipping behind the ears",
  },
  {
    id: "caesar",
    nombre: "Caesar texturizado",
    descripcion: "Todo corto con un flequillo corto horizontal. Ideal para disimular entradas.",
    mapa: mapa({ flequillo: [15, "texturizado"], superior: [18, "texturizado"], coronilla: [16, "texturizado"], lateral_alto: [10, "maquina"], lateral_bajo: [6, "degradado"], nuca_alta: [10, "maquina"], nuca_baja: [4.5, "degradado"], patillas: [6, "maquina"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["ovalado", "cuadrado", "alargado", "corazon"],
    evita: [],
    pelos: ["liso", "ondulado"],
    mantencion: 4,
    disimulaEntradas: true,
    visual: "a textured Caesar cut, short all over with a short horizontal fringe brushed forward",
  },
  {
    id: "medio_tijera",
    nombre: "Medio largo a tijera",
    descripcion: "Todo a tijera con largo y movimiento, laterales tapando parte de la oreja.",
    mapa: mapa({ flequillo: [80, "tijera"], superior: [80, "tijera"], coronilla: [70, "tijera"], lateral_alto: [45, "tijera"], lateral_bajo: [35, "tijera"], nuca_alta: [55, "tijera"], nuca_baja: [45, "tijera"], patillas: [25, "tijera"], ...SIN_BARBA }, MAPA_NEUTRO),
    favorece: ["ovalado", "alargado", "corazon", "diamante"],
    evita: ["redondo"],
    pelos: ["liso", "ondulado", "rizado"],
    mantencion: 7,
    disimulaEntradas: false,
    visual: "a medium-length scissor cut with natural movement, hair around 8 cm on top and partially covering the ears",
  },
];

export const ESTILOS_BARBA = [
  { id: "sin_barba", nombre: "Sin barba", mapa: { barba_mejillas: [0, "navaja"], bigote: [0, "navaja"], menton: [0, "navaja"] }, visual: "clean shaven" },
  { id: "tres_dias", nombre: "Barba de tres días", mapa: { barba_mejillas: [3, "maquina"], bigote: [3, "maquina"], menton: [3, "maquina"] }, visual: "a groomed three-day stubble" },
  { id: "corta", nombre: "Barba corta perfilada", mapa: { barba_mejillas: [8, "maquina"], bigote: [8, "tijera"], menton: [10, "maquina"] }, visual: "a short, neatly lined beard (about 1 cm) with sharp cheek and neck lines" },
  { id: "completa", nombre: "Barba completa", mapa: { barba_mejillas: [18, "tijera"], bigote: [14, "tijera"], menton: [30, "tijera"] }, visual: "a full well-groomed beard (about 2-3 cm) with a slightly longer chin" },
  { id: "candado", nombre: "Candado", mapa: { barba_mejillas: [0, "navaja"], bigote: [8, "tijera"], menton: [12, "maquina"] }, visual: "a goatee connected to a mustache, cheeks shaved clean" },
] as const;
export type EstiloBarba = (typeof ESTILOS_BARBA)[number]["id"];

export function aplicarBarba(base: MapaCorte, estilo: EstiloBarba): MapaCorte {
  const barba = ESTILOS_BARBA.find((opcion) => opcion.id === estilo) ?? ESTILOS_BARBA[0];
  const salida = { ...base };
  for (const [zona, [mm, tecnica]] of Object.entries(barba.mapa) as [Zona, readonly [number, Tecnica]][]) salida[zona] = { mm, tecnica };
  return salida;
}

export type PerfilCliente = {
  forma: FormaRostro;
  pelo: TipoPelo;
  densidad: Densidad;
  entradas: Entradas;
  /** Lo que pide el cliente, en sus palabras. */
  pedido?: string;
};

export type Recomendacion = { corte: CorteCatalogo; puntaje: number; razones: string[] };

const PALABRAS: [RegExp, (corte: CorteCatalogo) => number, string][] = [
  [/corto|f[aá]cil|pr[aá]ctic|no (me )?quiero peinar/i, (c) => (c.mapa.superior.mm <= 35 ? 2 : -1), "pide algo corto y práctico"],
  [/largo|mantener|no (tan )?corto/i, (c) => (c.mapa.superior.mm >= 50 ? 2 : -1), "quiere mantener largo"],
  [/fade|degrad/i, (c) => (c.mapa.lateral_bajo.tecnica === "degradado" ? 2 : 0), "pidió degradado"],
  [/oficina|formal|trabajo|sobrio/i, (c) => (["taper_clasico", "caesar", "french_crop"].includes(c.id) ? 2 : c.id === "mullet_moderno" ? -2 : 0), "necesita algo sobrio"],
  [/entradas|calv|poco pelo/i, (c) => (c.disimulaEntradas ? 2 : -1), "quiere disimular entradas"],
  [/volumen|altura|alto/i, (c) => (c.mapa.superior.mm >= 55 ? 2 : 0), "quiere volumen"],
  [/mullet/i, (c) => (c.id === "mullet_moderno" ? 3 : 0), "pidió mullet"],
];

/**
 * Recomendación sin IA: por forma de rostro, tipo de pelo, entradas y lo que
 * pidió el cliente. Es la que se usa cuando no hay proveedor de análisis
 * configurado y la base con la que se contrasta lo que propone la IA.
 */
export function recomendarPorReglas(perfil: PerfilCliente, cuantos = 4): Recomendacion[] {
  const resultado = CATALOGO_CORTES.map((corte) => {
    let puntaje = 0;
    const razones: string[] = [];
    if (corte.favorece.includes(perfil.forma)) {
      puntaje += 3;
      razones.push(`favorece un rostro ${INFO_FORMA[perfil.forma].nombre.toLowerCase()}`);
    }
    if (corte.evita.includes(perfil.forma)) {
      puntaje -= 4;
      razones.push(`no conviene a un rostro ${INFO_FORMA[perfil.forma].nombre.toLowerCase()}`);
    }
    if (corte.pelos.includes(perfil.pelo)) {
      puntaje += 2;
      razones.push(`funciona con pelo ${INFO_PELO[perfil.pelo].toLowerCase()}`);
    } else {
      puntaje -= 3;
    }
    if (perfil.entradas !== "no") {
      puntaje += corte.disimulaEntradas ? 2 : perfil.entradas === "marcadas" ? -2 : 0;
      if (corte.disimulaEntradas) razones.push("disimula las entradas");
    }
    if (perfil.densidad === "baja" && corte.mapa.superior.mm >= 60) puntaje -= 2;
    for (const [patron, valor, motivo] of PALABRAS) {
      if (perfil.pedido && patron.test(perfil.pedido)) {
        const suma = valor(corte);
        puntaje += suma;
        if (suma > 0) razones.push(motivo);
      }
    }
    return { corte, puntaje, razones };
  });
  return resultado.sort((a, b) => b.puntaje - a.puntaje || a.corte.mantencion - b.corte.mantencion).slice(0, cuantos);
}

/** El mapa en frases, de arriba hacia abajo: lo que se le lee al barbero. */
export function resumenMapa(mapaCorte: MapaCorte, grupo?: "pelo" | "barba"): string[] {
  return ZONAS.filter((zona) => !grupo || INFO_ZONA[zona].grupo === grupo)
    .filter((zona) => INFO_ZONA[zona].grupo === "pelo" || mapaCorte[zona].mm > 0)
    .map((zona) => `${INFO_ZONA[zona].nombre}: ${etiquetaLargo(mapaCorte[zona].mm, mapaCorte[zona].tecnica)} (${INFO_TECNICA[mapaCorte[zona].tecnica].toLowerCase()})`);
}

/** El mapa en inglés y en milímetros: acompaña la descripción para el modelo de imagen. */
export function mapaParaImagen(mapaCorte: MapaCorte): string {
  const zonas: Record<Zona, string> = {
    flequillo: "fringe/front",
    superior: "top",
    coronilla: "crown",
    lateral_alto: "upper sides",
    lateral_bajo: "lower sides",
    nuca_alta: "upper back",
    nuca_baja: "nape",
    patillas: "sideburns",
    barba_mejillas: "beard on cheeks",
    bigote: "mustache",
    menton: "chin and neck beard",
  };
  return ZONAS.map((zona) => `${zonas[zona]} ${mapaCorte[zona].mm <= 0 ? "none/shaved" : `${mapaCorte[zona].mm} mm`}`).join(", ");
}

// ---------------------------------------------------------------------------
// Looks: la sesión en el sillón.
// ---------------------------------------------------------------------------

export const ESTADOS_LOOK = ["capturado", "analizado", "aprobado", "realizado", "descartado"] as const;
export type EstadoLook = (typeof ESTADOS_LOOK)[number];

export const VISTAS_LOOK = ["frontal", "tres_cuartos", "perfil", "nuca"] as const;
export type VistaLook = (typeof VISTAS_LOOK)[number];
export const INFO_VISTA: Record<VistaLook, { nombre: string; camara: string }> = {
  frontal: { nombre: "Frente", camara: "front view, looking straight at the camera, head and shoulders" },
  tres_cuartos: { nombre: "Tres cuartos", camara: "three-quarter view, head turned about 45 degrees to the right, head and shoulders" },
  perfil: { nombre: "Perfil", camara: "right side profile view, head turned 90 degrees, clearly showing the side fade and the ear" },
  nuca: { nombre: "Nuca", camara: "back view of the head showing the nape, the crown and the neckline" },
};

export type AnalisisLook = {
  rostro: { forma: FormaRostro; confianza: "alta" | "media" | "baja"; frente: string; mandibula: string; pomulos: string; notas: string };
  pelo: { tipo: TipoPelo; grosor: "fino" | "medio" | "grueso"; densidad: Densidad; color: string; largo_actual_mm: number; entradas: Entradas; remolinos: string; linea_nacimiento: string };
  barba: { tiene: boolean; densidad: "nula" | "baja" | "media" | "alta"; estilo_actual: string };
  estilo_actual: string;
  foto_util: boolean;
  problema_foto: string;
  evitar: { nombre: string; por_que: string }[];
  notas_para_barbero: string;
};

export type PropuestaLook = {
  id: string;
  orden: number;
  nombre: string;
  corte_base: string | null;
  por_que: string;
  que_decirle: string | null;
  mantencion_semanas: number;
  dificultad: "baja" | "media" | "alta";
  barba: string | null;
  descripcion_visual: string;
  mapa: MapaCorte;
  origen: "ia" | "reglas" | "barbero";
  /** Vista → URL firmada (en el cliente) o ruta del archivo (en la base). */
  vistas: Partial<Record<VistaLook, string>>;
  /** El 3D del look: URL firmada del GLB cuando está listo. */
  modelo?: { estado: "generando" | "listo" | "fallido"; url: string | null } | null;
};

/** Colores de pelo que entiende la cabeza 3D, por la palabra con que se describe. */
export function colorDePelo(descripcion: string | null | undefined): string {
  const texto = (descripcion ?? "").toLowerCase();
  if (/plat|blanc/.test(texto)) return "#e7ddc9";
  if (/can|gris/.test(texto)) return "#9c9891";
  if (/rubio claro|dorad/.test(texto)) return "#c9a26a";
  if (/rubio/.test(texto)) return "#a98050";
  if (/roj|cobr|pelirr/.test(texto)) return "#8a3a1c";
  if (/casta[ñn]o claro/.test(texto)) return "#6e4c33";
  if (/negro|azabache/.test(texto)) return "#17120f";
  if (/casta[ñn]o/.test(texto)) return "#3e2b1f";
  return "#2a1f18";
}

/** Escala de color del mapa técnico: de piel (al cero) a café profundo (tijera larga). */
export const ESCALA_LARGO: [number, string][] = [
  [0, "#fbe7b5"],
  [1.5, "#f6c75c"],
  [6, "#ec9a2a"],
  [13, "#cf6b17"],
  [25, "#9c3f0f"],
  [50, "#64220a"],
  [100, "#2c0e04"],
];

function mezclar(desde: string, hasta: string, t: number): string {
  const a = parseInt(desde.slice(1), 16);
  const b = parseInt(hasta.slice(1), 16);
  const canal = (valor: number, corrimiento: number) => (valor >> corrimiento) & 255;
  const c = [16, 8, 0].map((corrimiento) => Math.round(canal(a, corrimiento) + (canal(b, corrimiento) - canal(a, corrimiento)) * t));
  return `#${c.map((valor) => valor.toString(16).padStart(2, "0")).join("")}`;
}

export function colorDeLargo(mm: number): string {
  if (mm <= 0) return "#f4efe8";
  for (let i = 1; i < ESCALA_LARGO.length; i++) {
    const [m0, c0] = ESCALA_LARGO[i - 1];
    const [m1, c1] = ESCALA_LARGO[i];
    if (mm <= m1) return mezclar(c0, c1, (mm - m0) / (m1 - m0));
  }
  return ESCALA_LARGO[ESCALA_LARGO.length - 1][1];
}
