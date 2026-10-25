// Lógica del sorteo de amigo invisible.
// Sin dependencias: funciona en Cloudflare Workers, Node y navegadores.

export interface Persona {
  nombre: string;
  email: string;
}

/** Quién regala a quién en un sorteo: email del que regala -> email del que recibe. */
export type Asignacion = Record<string, string>;

export interface OpcionesSorteo {
  /** Sorteos de años anteriores cuyas parejas no se pueden repetir (p. ej. los 2 últimos). */
  historial?: Asignacion[];
  /** Pares de emails que no pueden tocarse entre sí (parejas, hermanos...). Vale en ambas direcciones. */
  noPueden?: [string, string][];
  /** Intentos máximos antes de rendirse. */
  maxIntentos?: number;
}

export class SorteoImposibleError extends Error {
  constructor(intentos: number) {
    super(
      `No se encontró un sorteo válido tras ${intentos} intentos. ` +
        `Probablemente las restricciones (historial + parejas) son demasiado estrictas.`
    );
    this.name = "SorteoImposibleError";
  }
}

/**
 * Fisher-Yates con aleatoriedad criptográfica: devuelve una copia barajada.
 * Pedir números aleatorios es lo más caro, así que se piden todos de una vez (no uno por uno):
 * el plan gratuito de Cloudflare Workers solo da 10 ms de CPU por petición.
 * Sin sesgo de módulo: un valor que cae en la zona "injusta" se descarta y se usa el siguiente.
 */
function barajar<T>(items: readonly T[]): T[] {
  const copia = [...items];
  const azar = new Uint32Array(copia.length * 2);
  crypto.getRandomValues(azar);
  let pos = 0;
  const siguiente = (): number => {
    if (pos === azar.length) {
      crypto.getRandomValues(azar); // casi nunca hace falta: solo si se descartan muchos valores
      pos = 0;
    }
    return azar[pos++];
  };
  for (let i = copia.length - 1; i > 0; i--) {
    const max = i + 1;
    const limite = Math.floor(0x100000000 / max) * max;
    let r = siguiente();
    while (r >= limite) r = siguiente();
    const j = r % max;
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

const clave = (a: string, b: string) => `${a}\u0000${b}`;

/**
 * Sortea quién regala a quién.
 * Reglas: nadie se toca a sí mismo, nadie repite pareja del historial,
 * y los pares de `noPueden` no se tocan entre sí.
 * Barajar y comprobar mantiene el reparto uniforme entre todos los sorteos válidos.
 */
export function sortear(personas: Persona[], opciones: OpcionesSorteo = {}): Asignacion {
  const { historial = [], noPueden = [], maxIntentos = 100_000 } = opciones;

  if (personas.length < 2) {
    throw new Error("Hacen falta al menos 2 personas.");
  }
  const emails = personas.map((p) => p.email.trim().toLowerCase());
  if (new Set(emails).size !== emails.length) {
    throw new Error("Hay emails repetidos en la lista de participantes.");
  }

  // Parejas prohibidas: historial (dirigido) + noPueden (en ambas direcciones).
  const prohibidas = new Set<string>();
  for (const anio of historial) {
    for (const [da, recibe] of Object.entries(anio)) {
      prohibidas.add(clave(da.toLowerCase(), recibe.toLowerCase()));
    }
  }
  for (const [a, b] of noPueden) {
    prohibidas.add(clave(a.toLowerCase(), b.toLowerCase()));
    prohibidas.add(clave(b.toLowerCase(), a.toLowerCase()));
  }

  for (let intento = 0; intento < maxIntentos; intento++) {
    const receptores = barajar(emails);
    let valido = true;
    for (let i = 0; i < emails.length; i++) {
      if (emails[i] === receptores[i] || prohibidas.has(clave(emails[i], receptores[i]))) {
        valido = false;
        break;
      }
    }
    if (valido) {
      const resultado: Asignacion = {};
      emails.forEach((e, i) => (resultado[e] = receptores[i]));
      return resultado;
    }
  }
  throw new SorteoImposibleError(maxIntentos);
}

/**
 * Historial para guardar: solo los 2 sorteos más recientes (el actual + el anterior).
 * Con el sorteo nuevo ya hecho, los 2 años a evitar el próximo año serán estos.
 */
export function actualizarHistorial(
  historialPrevio: Asignacion[],
  nuevo: Asignacion,
  aniosAGuardar = 2
): Asignacion[] {
  return [nuevo, ...historialPrevio].slice(0, aniosAGuardar);
}
