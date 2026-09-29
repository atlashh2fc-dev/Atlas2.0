import { crearOportunidad } from "@/app/actions/ventas";
import { CreatePanel } from "@/components/create-panel";
import { Field, Input, Select } from "@/components/ui";
import type { VocabularioVentas } from "@/lib/ediciones";
import { createClient } from "@/lib/supabase/server";

const pesos = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

/**
 * El botón y el panel para crear un negocio. Vive donde se miran los negocios
 * (tablero y lista): si hubiera que ir a otra pantalla a crearlo, el botón
 * sería un enlace disfrazado.
 */
export async function NuevoNegocio({ voc }: { voc: VocabularioVentas }) {
  const mensual = voc.monto === "mensual";
  const supabase = await createClient();
  const { data: productos } = await supabase.from("sales_products").select("code, name, monthly_price, one_time_price").eq("active", true).order("name");

  return (
    <CreatePanel
      label={voc.nuevo}
      title={voc.nuevo}
      description={`Si ${voc.cuenta.toLowerCase() === "empresa" ? "la empresa" : `el ${voc.cuenta.toLowerCase()}`} ya existe, se reutiliza. El precio sale del catálogo salvo que escribas otro.`}
      action={crearOportunidad}
      submitLabel={voc.nuevo.replace(/^Nuev[oa] /, "Crear ")}
      successLabel={`${voc.negocio} creado`}
    >
      <Field label={voc.cuenta}>
        <Input name="empresa" required placeholder={voc.cuentaPlaceholder} data-autofocus />
      </Field>
      <Field label="RUT (opcional)">
        <Input name="rut" placeholder="76.123.456-7" />
      </Field>
      <Field label={voc.negocio}>
        <Input name="nombre" required placeholder={voc.negocioPlaceholder} />
      </Field>
      <Field label={voc.producto}>
        <Select name="producto" defaultValue="">
          <option value="">Sin {voc.producto.toLowerCase()} del catálogo</option>
          {(productos ?? []).map((producto) => (
            <option key={producto.code} value={producto.code}>
              {producto.name}
              {mensual
                ? producto.monthly_price
                  ? ` · ${pesos.format(Number(producto.monthly_price))}/mes`
                  : ""
                : producto.one_time_price
                  ? ` · ${pesos.format(Number(producto.one_time_price))}`
                  : ""}
            </option>
          ))}
        </Select>
      </Field>
      {mensual ? (
        <Field label="Monto mensual (deja vacío para usar el del catálogo)">
          <Input name="monto_mensual" inputMode="numeric" placeholder="69990" />
        </Field>
      ) : (
        <Field label="Monto del presupuesto">
          <Input name="monto_unico" inputMode="numeric" placeholder="1850000" />
        </Field>
      )}
      {!voc.personas && (
        <Field label="Contacto">
          <Input name="contacto" placeholder="María Soto" />
        </Field>
      )}
      <Field label={voc.personas ? "Correo" : "Correo del contacto"}>
        <Input name="contacto_email" type="email" placeholder="maria@laespiga.cl" />
      </Field>
      <Field label="WhatsApp o teléfono">
        <Input name="contacto_telefono" placeholder="+56 9 1111 1111" />
      </Field>
      <Field label="Cierre estimado">
        <Input name="cierre_estimado" type="date" />
      </Field>
      <Field label="Origen">
        <Select name="origen" defaultValue="">
          <option value="">Sin origen</option>
          {voc.origenes.map((origen) => (
            <option key={origen.value} value={origen.value}>
              {origen.label}
            </option>
          ))}
        </Select>
      </Field>
    </CreatePanel>
  );
}
