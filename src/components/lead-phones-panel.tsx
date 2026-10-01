import { Phone, PhoneOff, Plus } from "lucide-react";
import { ActionForm, ActionSubmit, Input } from "@/components/ui";
import {
  addLeadPhone,
  deactivateLeadPhone,
  liftLeadPhoneSuppression,
  listLeadDialPhones,
  setLeadPrimaryPhone,
  type LeadDialPhone,
} from "@/app/actions/lead-phones";
import { formatDialDigits } from "@/lib/phone-format";

/**
 * Teléfonos de la ficha, en el orden en que el ejecutivo los ve al llamar: el
 * principal (opción 1, el que marca el discador) y después los adicionales.
 * Supervisión y administración agregan números fuera de base, dejan uno como
 * principal o dan de baja uno; el ejecutivo solo los ve.
 *
 * Se dibuja dentro del grupo "Teléfonos" de la columna de propiedades: no trae
 * borde ni título propio.
 */
export async function LeadPhonesPanel({ leadId, canManage }: { leadId: string; canManage: boolean }) {
  let phones: LeadDialPhone[] = [];
  let error: string | null = null;
  try {
    phones = await listLeadDialPhones(leadId);
  } catch (err) {
    error = err instanceof Error ? err.message : "No se pudieron leer los teléfonos.";
  }

  return (
    <div className="space-y-3 text-[13px]">
      {error && <p className="text-xs text-danger">{error}</p>}
      {!error && phones.length === 0 && (
        <p className="text-xs text-muted-foreground">Sin teléfonos marcables.</p>
      )}
      {phones.length > 0 && (
        <ol className="space-y-3">
          {phones.map((phone, index) => {
            const blocked = Boolean(phone.blockedReason);
            return (
              <li key={phone.dialDigits} className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <span
                    className="icon-chip size-7 rounded-lg"
                    data-tone={blocked ? "rose" : phone.isPrimary ? "primary" : "slate"}
                    aria-hidden="true"
                  >
                    {blocked ? <PhoneOff size={13} /> : <Phone size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="tabular-nums font-medium text-foreground">{formatDialDigits(phone.dialDigits)}</p>
                    <p className="text-xs text-muted-foreground">
                      {/* El orden es el de la barra del teléfono al llamar. */}
                      Opción {index + 1} · {phone.isPrimary ? "Principal" : phone.label ?? "Adicional"}
                      {blocked && <span className="font-medium text-danger"> · No llamar</span>}
                    </p>
                  </div>
                </div>
                {canManage && blocked && (
                  <ActionForm
                    action={liftLeadPhoneSuppression}
                    success="Número liberado de la lista de no llamar"
                    className="flex flex-wrap items-center gap-1.5 pl-[38px]"
                  >
                    <input type="hidden" name="lead_id" value={leadId} />
                    <input type="hidden" name="phone" value={phone.dialDigits} />
                    <Input
                      name="reason"
                      required
                      placeholder="Motivo para liberarlo"
                      aria-label="Motivo para liberar el número"
                      className="h-8 min-w-0 flex-1 text-xs"
                    />
                    <ActionSubmit variant="secondary" size="sm" pendingLabel="Liberando…">
                      Liberar
                    </ActionSubmit>
                  </ActionForm>
                )}
                {canManage && !phone.isPrimary && (
                  <div className="flex flex-wrap gap-1 pl-[34px]">
                    <ActionForm action={setLeadPrimaryPhone} success="Quedó como número principal">
                      <input type="hidden" name="lead_id" value={leadId} />
                      <input type="hidden" name="phone" value={phone.dialDigits} />
                      <ActionSubmit variant="ghost" size="sm" pendingLabel="Guardando…">
                        Dejar como principal
                      </ActionSubmit>
                    </ActionForm>
                    {/* Dar de baja queda al final y sin color de primario. */}
                    {phone.contactId && (
                      <ActionForm action={deactivateLeadPhone} success="Número dado de baja">
                        <input type="hidden" name="lead_id" value={leadId} />
                        <input type="hidden" name="contact_id" value={phone.contactId} />
                        <ActionSubmit variant="ghost" size="sm" pendingLabel="Guardando…">
                          Dar de baja
                        </ActionSubmit>
                      </ActionForm>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {canManage && (
        // Se despliega al pedirlo: es una tarea ocasional de supervisión y
        // abierta ocupaba media columna en cada ficha.
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <Plus size={13} aria-hidden="true" />
            Agregar número fuera de base
          </summary>
          <ActionForm action={addLeadPhone} success="Número agregado" className="mt-2.5 space-y-2">
            <input type="hidden" name="lead_id" value={leadId} />
            <Input name="phone" required placeholder="9 1234 5678 o 2 2345 6789" inputMode="tel" aria-label="Número" />
            <Input name="label" placeholder="Etiqueta (opcional): gerente, sucursal…" aria-label="Etiqueta" />
            <ActionSubmit size="sm" variant="secondary" pendingLabel="Agregando…">
              Agregar número
            </ActionSubmit>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
