"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, CircleAlert, Database, Loader2, Search, UserRoundCheck } from "lucide-react";

import { buscarRutTerreno, crearClienteTerreno, type BusquedaRut } from "@/app/actions/terreno";
import { formatRut, isValidRut } from "@/lib/rut";
import { DATOS_VACIOS, ETAPA_INFO, type DatosCliente } from "@/lib/terreno";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CampoTerreno, InputTerreno } from "./campos";
import { DatosClienteForm } from "./datos-cliente-form";

type Paso = { tipo: "rut" } | { tipo: "datos"; rut: string; propuesta: Partial<DatosCliente>; busqueda: Extract<BusquedaRut, { ok: true }> | null };

const FUENTE_LABEL = {
  atlas: "Atlas",
  bigdata: "Bigdata",
  atlas_y_bigdata: "Atlas y Bigdata",
} as const;

/**
 * Ingreso de un cliente en dos pasos: primero el RUT (si lo tiene), para no
 * duplicar y para traer lo que ya se sabe; después los datos, con lo traído
 * ya escrito. Sin RUT se salta directo al formulario.
 */
export function NuevoCliente({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>({ tipo: "rut" });
  const [rut, setRut] = useState("");
  const [rutError, setRutError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<BusquedaRut | null>(null);
  const [buscando, startBuscar] = useTransition();

  function buscar(event: React.FormEvent) {
    event.preventDefault();
    if (!isValidRut(rut)) {
      setRutError("RUT inválido: revisa los números y el dígito verificador.");
      return;
    }
    setRutError(null);
    startBuscar(async () => {
      const respuesta = await buscarRutTerreno(campaignId, rut);
      setResultado(respuesta);
      if (respuesta.ok && !respuesta.enCampana) {
        setPaso({ tipo: "datos", rut: respuesta.rut, propuesta: respuesta.propuesta, busqueda: respuesta });
      }
    });
  }

  async function guardar(datos: DatosCliente) {
    const completadoCon =
      paso.tipo === "datos" && paso.busqueda?.fuente ? (paso.busqueda.fuente === "atlas" ? "atlas" : "bigdata") : null;
    const respuesta = await crearClienteTerreno(campaignId, datos, completadoCon);
    if (respuesta.ok) router.push(`/terreno/clientes/${respuesta.leadId}?nuevo=1`);
    return respuesta;
  }

  if (paso.tipo === "datos") {
    const completados = (Object.keys(paso.propuesta) as (keyof DatosCliente)[]).filter((campo) => paso.propuesta[campo]);
    const fuente = paso.busqueda?.fuente;
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => setPaso({ tipo: "rut" })}
          className="-ml-2 inline-flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted-foreground"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Cambiar RUT
        </button>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Paso 2 de 2</p>
          <h1 className="mt-0.5 text-xl font-semibold">Datos del cliente</h1>
        </div>

        {fuente ? (
          <div className="flex gap-3 rounded-xl border border-success/30 bg-success/5 p-3.5 text-sm">
            <Database size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
            <p>
              Trajimos {completados.length} {completados.length === 1 ? "dato" : "datos"} desde {FUENTE_LABEL[fuente]}. Revisa
              y completa lo que falte.
            </p>
          </div>
        ) : paso.rut ? (
          <div className="flex gap-3 rounded-xl border border-border bg-surface-muted p-3.5 text-sm">
            <CircleAlert size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p>
              No encontramos datos de este RUT. Ingrésalos tú.
              {paso.busqueda?.avisoBigdata && <span className="block text-muted-foreground">{paso.busqueda.avisoBigdata}</span>}
            </p>
          </div>
        ) : null}

        <DatosClienteForm
          inicial={{ ...DATOS_VACIOS, ...stripUndefined(paso.propuesta), rut: paso.rut }}
          rutBloqueado={Boolean(paso.rut)}
          completados={completados}
          submitLabel="Guardar cliente"
          onSubmit={guardar}
        />
      </div>
    );
  }

  const enCampana = resultado?.ok ? resultado.enCampana : null;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Paso 1 de 2</p>
        <h1 className="mt-0.5 text-xl font-semibold">Nuevo cliente</h1>
        <p className="mt-1 text-sm text-muted-foreground">Con el RUT revisamos si ya existe y traemos sus datos.</p>
      </div>

      <form onSubmit={buscar} className="space-y-3" noValidate>
        <CampoTerreno label="RUT del comercio o persona" error={rutError}>
          <InputTerreno
            value={rut}
            onChange={(event) => {
              setRut(event.target.value);
              setResultado(null);
              if (rutError) setRutError(null);
            }}
            onBlur={() => {
              if (rut.trim() && isValidRut(rut)) setRut(formatRut(rut));
            }}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="12.345.678-9"
            aria-invalid={Boolean(rutError)}
          />
        </CampoTerreno>
        <button type="submit" disabled={buscando || !rut.trim()} className={BOTON_PRIMARIO}>
          {buscando ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
          {buscando ? "Buscando en Atlas y Bigdata…" : "Buscar"}
        </button>
      </form>

      {resultado && !resultado.ok && (
        <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">
          {resultado.message}
        </p>
      )}

      {enCampana && (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4" role="status">
          <div className="flex gap-3">
            <UserRoundCheck size={20} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold">{enCampana.propio ? "Ya es tu cliente" : "Este cliente ya está en la campaña"}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {enCampana.nombre}
                {enCampana.etapa ? ` · ${ETAPA_INFO[enCampana.etapa].label}` : ""}
                {!enCampana.propio && ` · lo gestiona ${enCampana.vendedor ?? "otro vendedor"}`}
              </p>
            </div>
          </div>
          {enCampana.propio ? (
            <Link href={`/terreno/clientes/${enCampana.leadId}`} className={BOTON_SECUNDARIO}>
              Abrir ficha
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">Si te corresponde a ti, pide a tu supervisor que lo reasigne.</p>
          )}
        </div>
      )}

      <div className="border-t border-border pt-5">
        <button
          type="button"
          onClick={() => setPaso({ tipo: "datos", rut: "", propuesta: {}, busqueda: null })}
          className={BOTON_SECUNDARIO}
        >
          No tengo el RUT
        </button>
      </div>
    </div>
  );
}

function stripUndefined(value: Partial<DatosCliente>): Partial<DatosCliente> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "string" && v !== "")) as Partial<DatosCliente>;
}
