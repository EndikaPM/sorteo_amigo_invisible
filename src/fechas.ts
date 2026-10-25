// Utilidades de fechas.

/**
 * Devuelve el próximo día de Reyes (6 de enero).
 * Si ese día ya ha pasado este año, devuelve el del año siguiente.
 * El propio 6 de enero cuenta como "este año".
 */
export function proximosReyes(hoy: Date = new Date()): Date {
  const hoySinHora = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const reyesEsteAnio = new Date(hoy.getFullYear(), 0, 6);
  const anio = hoySinHora > reyesEsteAnio ? hoy.getFullYear() + 1 : hoy.getFullYear();
  return new Date(anio, 0, 6);
}

/** Fecha en español, p. ej. "miércoles, 6 de enero". */
export function formatoFecha(fecha: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(fecha);
}

/** Convierte a "YYYY-MM-DD" (formato de input type="date") en hora local. */
export function aISO(fecha: Date): string {
  const anio = String(fecha.getFullYear()).padStart(4, "0");
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

/** Parsea un "YYYY-MM-DD" como fecha local (sin desfase UTC). */
export function desdeISO(iso: string): Date {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}
