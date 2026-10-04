/**
 * Atlas Órbita · el horario de los agentes.
 *
 * Lee el cron de cinco campos que declara cada agente ("30 8 * * *",
 * "0 10 * * 1,4", "*\/15 * * * *") en hora de Chile y responde cuándo le
 * tocaba su último turno. Puro y sin dependencias: lo usan el reloj de la nube
 * y las pruebas.
 */

export const ZONA_CHILE = "America/Santiago";

type Campo = Set<number>;
export type CronLeido = { minutos: Campo; horas: Campo; dias: Campo; meses: Campo; semana: Campo; diaLibre: boolean; semanaLibre: boolean };

function leerCampo(texto: string, min: number, max: number): Campo | null {
  const valores = new Set<number>();
  for (const parte of texto.split(",")) {
    const [rango, pasoTexto] = parte.split("/");
    const paso = pasoTexto === undefined ? 1 : Number(pasoTexto);
    if (!Number.isInteger(paso) || paso < 1) return null;
    let desde: number;
    let hasta: number;
    if (rango === "*") {
      desde = min;
      hasta = max;
    } else if (rango.includes("-")) {
      const [a, b] = rango.split("-").map(Number);
      desde = a;
      hasta = b;
    } else {
      desde = Number(rango);
      hasta = pasoTexto === undefined ? desde : max;
    }
    if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < min || hasta > max || desde > hasta) return null;
    for (let valor = desde; valor <= hasta; valor += paso) valores.add(valor);
  }
  return valores.size > 0 ? valores : null;
}

/** Null si el cron no se entiende: ese agente no se agenda, no se adivina. */
export function leerCron(cron: string | null | undefined): CronLeido | null {
  const campos = (cron ?? "").trim().split(/\s+/);
  if (campos.length !== 5) return null;
  const [m, h, d, mes, s] = campos;
  const minutos = leerCampo(m, 0, 59);
  const horas = leerCampo(h, 0, 23);
  const dias = leerCampo(d, 1, 31);
  const meses = leerCampo(mes, 1, 12);
  const semanaCruda = leerCampo(s, 0, 7);
  if (!minutos || !horas || !dias || !meses || !semanaCruda) return null;
  // 7 también es domingo.
  const semana = new Set([...semanaCruda].map((dia) => dia % 7));
  return { minutos, horas, dias, meses, semana, diaLibre: d === "*", semanaLibre: s === "*" };
}

const formato = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_CHILE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  weekday: "short",
  hour12: false,
});
const DIAS_SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export type HoraChile = { anio: number; mes: number; dia: number; hora: number; minuto: number; semana: number };

export function horaDeChile(instante: Date): HoraChile {
  const partes: Record<string, string> = {};
  for (const parte of formato.formatToParts(instante)) partes[parte.type] = parte.value;
  return {
    anio: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour) % 24,
    minuto: Number(partes.minute),
    semana: DIAS_SEMANA[partes.weekday] ?? 0,
  };
}

export function coincide(cron: CronLeido, hora: HoraChile): boolean {
  if (!cron.minutos.has(hora.minuto) || !cron.horas.has(hora.hora) || !cron.meses.has(hora.mes)) return false;
  const porDia = cron.dias.has(hora.dia);
  const porSemana = cron.semana.has(hora.semana);
  // Regla de cron: si se restringen ambos, basta con uno.
  if (cron.diaLibre && cron.semanaLibre) return true;
  if (cron.diaLibre) return porSemana;
  if (cron.semanaLibre) return porDia;
  return porDia || porSemana;
}

const MINUTO = 60_000;

/**
 * El último turno que le tocaba al agente, a más tardar `ahora` y dentro de
 * la ventana (por defecto 24 h). Recorre minuto a minuto hacia atrás: con la
 * hora de Chile del sistema no hay que razonar el cambio de horario a mano.
 */
export function ultimoTurno(cron: string | null | undefined, ahora: Date, ventanaMin = 24 * 60): Date | null {
  const leido = leerCron(cron);
  if (!leido) return null;
  const inicio = Math.floor(ahora.getTime() / MINUTO) * MINUTO;
  for (let i = 0; i <= ventanaMin; i += 1) {
    const instante = new Date(inicio - i * MINUTO);
    if (coincide(leido, horaDeChile(instante))) return instante;
  }
  return null;
}

/** "lunes", "domingo"… en Chile, para que los motores sepan qué toca hoy. */
export function diaDeLaSemana(instante: Date): number {
  return horaDeChile(instante).semana;
}

/** "2026-10-04" en Chile. */
export function fechaDeChile(instante: Date): string {
  const { anio, mes, dia } = horaDeChile(instante);
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}
