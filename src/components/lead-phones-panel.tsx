import { ActionForm, ActionSubmit, Badge, Input } from "@/components/ui";
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
    <div className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Teléfonos para llamar</p>
      {error && <p className="text-xs text-danger">{error}</p>}
      {!error && phones.length === 0 && <p className="text-xs text-muted-foreground">Sin teléfonos marcables.</p>}
      <ol className="space-y-2">
        {phones.map((phone, index) => (
          <li key={phone.dialDigits} className="space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="tabular-nums text-foreground">
                  {index + 1}. {formatDialDigits(phone.dialDigits)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {phone.isPrimary ? "Principal" : phone.label ?? "Adicional"}
                </p>
              </div>
              {phone.isPrimary && <Badge tone="success">Principal</Badge>}
              {phone.blockedReason && <Badge tone="danger">No llamar</Badge>}
            </div>
            {canManage && phone.blockedReason && (
              <ActionForm action={liftLeadPhoneSuppression} success="Número liberado de la lista de no llamar" className="flex flex-wrap items-center gap-1.5">
                <input type="hidden" name="lead_id" value={leadId} />
                <input type="hidden" name="phone" value={phone.dialDigits} />
                <Input name="reason" required placeholder="Motivo para liberarlo" aria-label="Motivo para liberar el número" className="h-8 min-w-0 flex-1 text-xs" />
                <ActionSubmit variant="secondary" size="sm" pendingLabel="Liberando…">
                  Liberar
                </ActionSubmit>
              </ActionForm>
            )}
            {canManage && !phone.isPrimary && (
              <div className="flex flex-wrap gap-1.5">
                <ActionForm action={setLeadPrimaryPhone} success="Quedó como número principal">
                  <input type="hidden" name="lead_id" value={leadId} />
                  <input type="hidden" name="phone" value={phone.dialDigits} />
                  <ActionSubmit variant="secondary" size="sm" pendingLabel="Guardando…">
                    Dejar como principal
                  </ActionSubmit>
                </ActionForm>
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
        ))}
      </ol>

      {canManage && (
        <ActionForm action={addLeadPhone} success="Número agregado" className="space-y-1.5 border-t border-border pt-3">
          <input type="hidden" name="lead_id" value={leadId} />
          <p className="text-xs font-medium text-foreground">Agregar número fuera de base</p>
          <Input name="phone" required placeholder="9 1234 5678 o 2 2345 6789" inputMode="tel" aria-label="Número" />
          <Input name="label" placeholder="Etiqueta (opcional): gerente, sucursal…" aria-label="Etiqueta" />
          <ActionSubmit size="sm" pendingLabel="Agregando…">
            Agregar número
          </ActionSubmit>
        </ActionForm>
      )}
    </div>
  );
}
