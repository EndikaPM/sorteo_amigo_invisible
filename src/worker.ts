// Servidor del amigo invisible (Cloudflare Worker).
// Hace el sorteo, envía un email a cada persona (con Resend) y guarda el historial en KV.
//
// REGLA DE ORO: el resultado del sorteo NUNCA sale en una respuesta HTTP. Solo viaja por email.
//
// Rutas (todas piden la contraseña en la cabecera "Authorization: Bearer <contraseña>", y la contraseña
// viaja codificada con encodeURIComponent para que ñ, tildes y símbolos no se estropeen en la cabecera):
//   GET  /api/estado               -> años guardados en el historial y si hay un sorteo a medias
//   POST /api/prueba-envio         -> manda un email de ejemplo a una dirección (para probar el dominio)
//   POST /api/sortear              -> sortea y envía ("simulacro": true solo comprueba que hay solución)
//   POST /api/reintentar           -> reenvía solo a quienes fallaron en un sorteo a medias
//   POST /api/descartar-pendiente  -> borra un sorteo a medias para empezar de cero

import { sortear, SorteoImposibleError, type Asignacion, type Persona } from "./sorteo.ts";
import { generarEmail } from "./email.ts";
import { desdeISO, formatoFecha } from "./fechas.ts";

/** Lo mínimo que usamos de Workers KV (así se puede simular en las pruebas). */
export interface KV {
  get(clave: string): Promise<string | null>;
  put(clave: string, valor: string): Promise<void>;
  delete(clave: string): Promise<void>;
}

export interface Env {
  HISTORIAL: KV;
  /** Clave de la API de Resend (secreto). */
  RESEND_API_KEY: string;
  /** Contraseña de la web (secreto, mínimo 12 caracteres). */
  APP_PASSWORD: string;
  /** Remitente, p. ej. "Amigo invisible <sorteo@tudominio.com>". El dominio debe estar verificado en Resend. */
  REMITENTE: string;
  /** Solo para pruebas locales; en producción no se define. */
  RESEND_URL?: string;
}

/** Todo lo que toca el exterior, para poder simularlo en las pruebas. */
export interface Dependencias {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  ahora: () => Date;
  esperar: (ms: number) => Promise<void>;
  uuid: () => string;
}

interface EntradaHistorial {
  anio: number;
  fecha: string;
  asignacion: Asignacion;
}

/** Un sorteo ya hecho pero con emails sin enviar. Se guarda para reintentar SIN volver a sortear. */
interface Pendiente {
  id: string;
  anio: number;
  asignacion: Asignacion;
  personas: Persona[];
  titulo?: string;
  presupuesto?: string;
  fecha?: string;
  /** Emails (en minúsculas) de quienes ya recibieron su correo. */
  enviados: string[];
}

interface Solicitud {
  titulo?: string;
  presupuesto?: string;
  fecha?: string;
  personas: Persona[];
  simulacro: boolean;
  forzar: boolean;
}

const CLAVE_HISTORIAL = "historial";
const CLAVE_HISTORIAL_ANTERIOR = "historial_anterior";
const CLAVE_PENDIENTE = "pendiente";

const ANIOS_A_EVITAR = 2;
const MAX_PERSONAS = 30;
const MAX_CUERPO = 100_000;
const MAX_INTENTOS_ENVIO = 4;
/** Resend permite 10 peticiones por segundo; espaciamos un poco los envíos para ir sobrados. */
const PAUSA_ENTRE_ENVIOS_MS = 150;
/** El plan gratuito de Workers corta a los 10 ms de CPU: no se pueden hacer cientos de miles de intentos. */
const MAX_INTENTOS_SORTEO = 2000;

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function responder(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Compara dos textos sin que el tiempo que tarda delate cuántas letras coinciden. */
async function igualConstante(a: string, b: string): Promise<boolean> {
  const codificar = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", codificar.encode(a)),
    crypto.subtle.digest("SHA-256", codificar.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diferencias = 0;
  for (let i = 0; i < x.length; i++) diferencias |= x[i] ^ y[i];
  return diferencias === 0;
}

/** Quita saltos de línea y otros caracteres de control (evita inyectar cabeceras en el asunto). */
function limpiar(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

type Validado<T> = { ok: true; valor: T } | { ok: false; mensaje: string };

const error = (mensaje: string): { ok: false; mensaje: string } => ({ ok: false, mensaje });

function validarTextoOpcional(v: unknown, max: number, nombre: string): Validado<string | undefined> {
  if (v === undefined || v === null || v === "") return { ok: true, valor: undefined };
  if (typeof v !== "string") return error(`${nombre} no es válido.`);
  const limpio = limpiar(v);
  if (limpio.length > max) return error(`${nombre} es demasiado largo (máximo ${max} caracteres).`);
  return { ok: true, valor: limpio || undefined };
}

function validarFecha(v: unknown): Validado<string | undefined> {
  if (v === undefined || v === null || v === "") return { ok: true, valor: undefined };
  if (typeof v !== "string" || !REGEX_FECHA.test(v)) return error("La fecha no es válida.");
  const d = desdeISO(v);
  const real =
    !Number.isNaN(d.getTime()) &&
    d.getFullYear() === Number(v.slice(0, 4)) &&
    d.getMonth() + 1 === Number(v.slice(5, 7)) &&
    d.getDate() === Number(v.slice(8, 10));
  return real ? { ok: true, valor: v } : error("La fecha no existe en el calendario.");
}

function validarPersonas(v: unknown): Validado<Persona[]> {
  if (!Array.isArray(v)) return error("Falta la lista de participantes.");
  if (v.length < 2) return error("Hacen falta al menos 2 participantes.");
  if (v.length > MAX_PERSONAS) return error(`Demasiados participantes (máximo ${MAX_PERSONAS}).`);
  const vistos = new Set<string>();
  const resultado: Persona[] = [];
  for (const [i, bruto] of v.entries()) {
    const p = (bruto ?? {}) as { nombre?: unknown; email?: unknown };
    const nombre = typeof p.nombre === "string" ? limpiar(p.nombre) : "";
    const email = typeof p.email === "string" ? p.email.trim() : "";
    if (!nombre || nombre.length > 60) return error(`Participante ${i + 1}: el nombre está vacío o es demasiado largo.`);
    if (email.length > 254 || !REGEX_EMAIL.test(email)) return error(`Participante ${i + 1} (${nombre}): el email no es válido.`);
    const clave = email.toLowerCase();
    if (vistos.has(clave)) return error("Hay emails repetidos en la lista de participantes.");
    vistos.add(clave);
    resultado.push({ nombre, email });
  }
  return { ok: true, valor: resultado };
}

function validarSolicitud(cuerpo: unknown): Validado<Solicitud> {
  if (typeof cuerpo !== "object" || cuerpo === null) return error("El cuerpo de la petición no es válido.");
  const c = cuerpo as Record<string, unknown>;
  const titulo = validarTextoOpcional(c.titulo, 80, "El título");
  if (!titulo.ok) return error(titulo.mensaje);
  const presupuesto = validarTextoOpcional(c.presupuesto, 40, "El presupuesto");
  if (!presupuesto.ok) return error(presupuesto.mensaje);
  const fecha = validarFecha(c.fecha);
  if (!fecha.ok) return error(fecha.mensaje);
  const personas = validarPersonas(c.personas);
  if (!personas.ok) return error(personas.mensaje);
  return {
    ok: true,
    valor: {
      titulo: titulo.valor,
      presupuesto: presupuesto.valor,
      fecha: fecha.valor,
      personas: personas.valor,
      simulacro: c.simulacro === true,
      forzar: c.forzar === true,
    },
  };
}

async function leerJson(request: Request): Promise<unknown> {
  const texto = await request.text();
  if (texto.length > MAX_CUERPO) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Almacenamiento (KV)
// ---------------------------------------------------------------------------

function parsearHistorial(texto: string | null): EntradaHistorial[] {
  if (!texto) return [];
  const v = JSON.parse(texto);
  const valido =
    Array.isArray(v) &&
    v.every((h) => typeof h?.anio === "number" && typeof h?.asignacion === "object" && h.asignacion !== null);
  // Si el historial está roto NO se asume "vacío": se pararía la garantía de no repetir y se sobrescribiría.
  if (!valido) throw new Error("historial_corrupto");
  return v as EntradaHistorial[];
}

async function leerHistorial(env: Env): Promise<EntradaHistorial[]> {
  return parsearHistorial(await env.HISTORIAL.get(CLAVE_HISTORIAL));
}

async function leerPendiente(env: Env): Promise<Pendiente | null> {
  const texto = await env.HISTORIAL.get(CLAVE_PENDIENTE);
  return texto ? (JSON.parse(texto) as Pendiente) : null;
}

/** Guarda el sorteo como definitivo en el historial (solo los 2 años más recientes) y borra el pendiente. */
async function confirmar(env: Env, deps: Dependencias, pend: Pendiente): Promise<void> {
  const previoTexto = await env.HISTORIAL.get(CLAVE_HISTORIAL);
  const previo = parsearHistorial(previoTexto);
  const entrada: EntradaHistorial = {
    anio: pend.anio,
    fecha: deps.ahora().toISOString().slice(0, 10),
    asignacion: pend.asignacion,
  };
  const nuevo = [entrada, ...previo.filter((h) => h.anio !== pend.anio)]
    .sort((a, b) => b.anio - a.anio)
    .slice(0, ANIOS_A_EVITAR);
  if (previoTexto) await env.HISTORIAL.put(CLAVE_HISTORIAL_ANTERIOR, previoTexto); // copia de seguridad
  await env.HISTORIAL.put(CLAVE_HISTORIAL, JSON.stringify(nuevo));
  await env.HISTORIAL.delete(CLAVE_PENDIENTE);
}

// ---------------------------------------------------------------------------
// Envío con Resend
// ---------------------------------------------------------------------------

interface Mensaje {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  /** Si se repite la misma clave, Resend no manda el email dos veces. */
  claveUnica?: string;
}

async function describirError(r: Response): Promise<string> {
  let detalle = "";
  try {
    const j = (await r.json()) as { message?: unknown };
    if (typeof j.message === "string") detalle = j.message.slice(0, 200);
  } catch {
    // sin detalle legible
  }
  return detalle ? `Resend ${r.status}: ${detalle}` : `Resend ${r.status}`;
}

async function enviarUno(env: Env, deps: Dependencias, m: Mensaje): Promise<{ ok: boolean; motivo?: string }> {
  const url = env.RESEND_URL ?? "https://api.resend.com/emails";
  const cabeceras: Record<string, string> = {
    authorization: `Bearer ${env.RESEND_API_KEY}`,
    "content-type": "application/json",
  };
  if (m.claveUnica) cabeceras["idempotency-key"] = m.claveUnica;
  const cuerpo = JSON.stringify({ from: env.REMITENTE, to: [m.para], subject: m.asunto, html: m.html, text: m.texto });

  let motivo = "no se pudo conectar con Resend";
  for (let intento = 1; intento <= MAX_INTENTOS_ENVIO; intento++) {
    try {
      const r = await deps.fetch(url, { method: "POST", headers: cabeceras, body: cuerpo });
      if (r.ok) return { ok: true };
      motivo = await describirError(r);
      // Errores del tipo "dominio sin verificar" o "dirección inválida" no se arreglan reintentando.
      if (r.status !== 429 && r.status < 500) return { ok: false, motivo };
    } catch {
      motivo = "no se pudo conectar con Resend";
    }
    if (intento < MAX_INTENTOS_ENVIO) await deps.esperar(1100 * intento);
  }
  return { ok: false, motivo };
}

/** Envía los emails que falten del sorteo pendiente. Si salen todos, lo confirma; si no, lo deja pendiente. */
async function enviarYConfirmar(env: Env, deps: Dependencias, pend: Pendiente): Promise<Response> {
  const porEmail = new Map(pend.personas.map((p) => [p.email.toLowerCase(), p]));
  const enviados = new Set(pend.enviados);
  const fallos: { email: string; motivo: string }[] = [];
  const fecha = pend.fecha ? formatoFecha(desdeISO(pend.fecha)) : undefined;

  let hayEnvioPrevio = false;
  for (const [i, dador] of pend.personas.entries()) {
    const clave = dador.email.toLowerCase();
    if (enviados.has(clave)) continue;
    if (hayEnvioPrevio) await deps.esperar(PAUSA_ENTRE_ENVIOS_MS);
    hayEnvioPrevio = true;

    const receptor = porEmail.get(pend.asignacion[clave]);
    if (!receptor) throw new Error("sorteo_corrupto");
    const mail = generarEmail({
      nombreDador: dador.nombre,
      nombreReceptor: receptor.nombre,
      emailReceptor: receptor.email,
      titulo: pend.titulo,
      presupuesto: pend.presupuesto,
      fecha,
    });
    const resultado = await enviarUno(env, deps, {
      para: dador.email,
      asunto: mail.asunto,
      html: mail.html,
      texto: mail.texto,
      claveUnica: `${pend.id}:${i}`,
    });
    if (resultado.ok) enviados.add(clave);
    else fallos.push({ email: dador.email, motivo: resultado.motivo ?? "error desconocido" });
  }

  pend.enviados = [...enviados];
  if (fallos.length > 0) {
    await env.HISTORIAL.put(CLAVE_PENDIENTE, JSON.stringify(pend));
    return responder(
      {
        ok: false,
        error: "envio_incompleto",
        mensaje: "El sorteo está hecho, pero algunos emails no han salido. Arregla el problema y usa «reintentar»: no se volverá a sortear.",
        enviados: enviados.size,
        total: pend.personas.length,
        fallos,
      },
      502
    );
  }
  await confirmar(env, deps, pend);
  return responder({ ok: true, enviados: pend.personas.length });
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

async function accionEstado(env: Env): Promise<Response> {
  const pendiente = await leerPendiente(env);
  const historial = await leerHistorial(env);
  return responder({
    pendiente: pendiente ? { enviados: pendiente.enviados.length, total: pendiente.personas.length } : null,
    anios: historial.map((h) => h.anio).sort((a, b) => b - a),
  });
}

async function accionPruebaEnvio(env: Env, deps: Dependencias, cuerpo: unknown): Promise<Response> {
  const destino = typeof (cuerpo as { destino?: unknown } | null)?.destino === "string"
    ? ((cuerpo as { destino: string }).destino).trim()
    : "";
  if (!destino || destino.length > 254 || !REGEX_EMAIL.test(destino)) {
    return responder({ error: "datos_invalidos", mensaje: "La dirección de destino no es válida." }, 400);
  }
  const mail = generarEmail({
    nombreDador: "Ana",
    nombreReceptor: "Beto",
    emailReceptor: "beto@ejemplo.com",
    titulo: "PRUEBA de envío",
    presupuesto: "20 €",
  });
  const resultado = await enviarUno(env, deps, { para: destino, asunto: `[PRUEBA] ${mail.asunto}`, html: mail.html, texto: mail.texto });
  if (!resultado.ok) return responder({ ok: false, error: "fallo_envio", mensaje: resultado.motivo }, 502);
  return responder({ ok: true });
}

async function accionSortear(env: Env, deps: Dependencias, cuerpo: unknown): Promise<Response> {
  const validada = validarSolicitud(cuerpo);
  if (!validada.ok) return responder({ error: "datos_invalidos", mensaje: validada.mensaje }, 400);
  const solicitud = validada.valor;

  if (await leerPendiente(env)) {
    return responder(
      { error: "hay_sorteo_pendiente", mensaje: "Hay un sorteo a medias. Usa «reintentar» para terminarlo o «descartar» para empezar de cero." },
      409
    );
  }

  const anio = deps.ahora().getFullYear();
  const historial = await leerHistorial(env);
  if (!solicitud.simulacro && !solicitud.forzar && historial.some((h) => h.anio === anio)) {
    return responder(
      { error: "ya_hay_sorteo_este_anio", mensaje: `Ya hay un sorteo guardado de ${anio}. Si de verdad quieres repetirlo, confírmalo.` },
      409
    );
  }

  // Se evitan los 2 años anteriores al actual. Si se está rehaciendo el de este año, el descartado no cuenta.
  const aEvitar = historial
    .filter((h) => h.anio < anio)
    .sort((a, b) => b.anio - a.anio)
    .slice(0, ANIOS_A_EVITAR)
    .map((h) => h.asignacion);

  let asignacion: Asignacion;
  try {
    asignacion = sortear(solicitud.personas, { historial: aEvitar, maxIntentos: MAX_INTENTOS_SORTEO });
  } catch (e) {
    if (e instanceof SorteoImposibleError) {
      return responder({ error: "sorteo_imposible", mensaje: "No hay forma de repartirlo con estas restricciones. Prueba con otro grupo o menos años de historial." }, 422);
    }
    return responder({ error: "datos_invalidos", mensaje: e instanceof Error ? e.message : "Datos no válidos." }, 400);
  }

  // Simulacro: solo se confirma que hay solución. No se envía nada, no se guarda nada y no se enseña el reparto.
  if (solicitud.simulacro) return responder({ ok: true, simulacro: true, participantes: solicitud.personas.length });

  const pend: Pendiente = {
    id: deps.uuid(),
    anio,
    asignacion,
    personas: solicitud.personas,
    titulo: solicitud.titulo,
    presupuesto: solicitud.presupuesto,
    fecha: solicitud.fecha,
    enviados: [],
  };
  // Primero se guarda el sorteo como pendiente y luego se envía: si algo falla a mitad, no se pierde.
  await env.HISTORIAL.put(CLAVE_PENDIENTE, JSON.stringify(pend));
  return enviarYConfirmar(env, deps, pend);
}

async function accionReintentar(env: Env, deps: Dependencias): Promise<Response> {
  const pend = await leerPendiente(env);
  if (!pend) return responder({ error: "nada_pendiente", mensaje: "No hay ningún sorteo a medias." }, 404);
  return enviarYConfirmar(env, deps, pend);
}

async function accionDescartar(env: Env): Promise<Response> {
  await env.HISTORIAL.delete(CLAVE_PENDIENTE);
  return responder({ ok: true });
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const RUTAS = new Map<string, string>([
  ["/api/estado", "GET"],
  ["/api/prueba-envio", "POST"],
  ["/api/sortear", "POST"],
  ["/api/reintentar", "POST"],
  ["/api/descartar-pendiente", "POST"],
]);

export async function manejar(request: Request, env: Env, deps: Dependencias): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/api/")) return responder({ error: "no_encontrado" }, 404);

  // Sin una contraseña razonable configurada, el servidor no funciona (mejor parado que abierto).
  if (!env.APP_PASSWORD || env.APP_PASSWORD.length < 12) {
    return responder({ error: "configuracion", mensaje: "El servidor no está configurado correctamente." }, 500);
  }
  const cabecera = request.headers.get("authorization") ?? "";
  const codificada = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  let dada = "";
  try {
    // Las cabeceras HTTP solo admiten caracteres sencillos: la contraseña llega con encodeURIComponent.
    dada = decodeURIComponent(codificada);
  } catch {
    dada = ""; // mal codificada: no coincide con nada y acaba en 401
  }
  if (!(await igualConstante(dada, env.APP_PASSWORD))) return responder({ error: "no_autorizado" }, 401);

  const faltan = (["RESEND_API_KEY", "REMITENTE", "HISTORIAL"] as const).filter((k) => !env[k]);
  if (faltan.length > 0) return responder({ error: "configuracion", mensaje: `Falta configurar: ${faltan.join(", ")}` }, 500);

  const metodo = RUTAS.get(pathname);
  if (!metodo) return responder({ error: "no_encontrado" }, 404);
  if (request.method !== metodo) return responder({ error: "metodo_no_permitido" }, 405);

  try {
    switch (pathname) {
      case "/api/estado":
        return await accionEstado(env);
      case "/api/reintentar":
        return await accionReintentar(env, deps);
      case "/api/descartar-pendiente":
        return await accionDescartar(env);
      case "/api/prueba-envio": {
        const cuerpo = await leerJson(request);
        if (cuerpo === null) return responder({ error: "datos_invalidos", mensaje: "El cuerpo de la petición no es válido." }, 400);
        return await accionPruebaEnvio(env, deps, cuerpo);
      }
      default: {
        const cuerpo = await leerJson(request);
        if (cuerpo === null) return responder({ error: "datos_invalidos", mensaje: "El cuerpo de la petición no es válido." }, 400);
        return await accionSortear(env, deps, cuerpo);
      }
    }
  } catch (e) {
    console.error("Error interno:", e instanceof Error ? e.message : e);
    const conocido = e instanceof Error && (e.message === "historial_corrupto" || e.message === "sorteo_corrupto");
    return responder(
      {
        error: conocido ? (e as Error).message : "interno",
        mensaje: "Algo ha fallado en el servidor. Mira «estado» antes de repetir nada: puede que ya se hayan enviado emails.",
      },
      500
    );
  }
}

const dependenciasReales: Dependencias = {
  // OJO: fetch se envuelve en una función propia. Guardar "fetch" directamente en un objeto y llamarlo
  // como deps.fetch(...) hace que Workers falle con "Illegal invocation".
  fetch: (url, init) => fetch(url, init),
  ahora: () => new Date(),
  esperar: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
  uuid: () => crypto.randomUUID(),
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return manejar(request, env, dependenciasReales);
  },
};