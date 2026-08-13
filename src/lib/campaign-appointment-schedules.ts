export const LEGAL_APPOINTMENT_SCHEDULE_URL =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ2y9Zgskuwj0nnioyl7cgGNRXT8CpUH7PdOXeQKCmYjIJj9NTUnE7pjMkCaAKJD2a5AeTdIIWAA";

function normalizeCampaignName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

/**
 * Mantiene las agendas externas acotadas a su campaña. No conviene entregar
 * esta URL a todas las gestiones: una reserva en el calendario equivocado
 * genera un compromiso que después no aparece en la operación correspondiente.
 */
export function getCampaignAppointmentScheduleUrl(campaignName: string | null | undefined): string | null {
  if (!campaignName) return null;

  return normalizeCampaignName(campaignName) === "abogado legal"
    ? LEGAL_APPOINTMENT_SCHEDULE_URL
    : null;
}
