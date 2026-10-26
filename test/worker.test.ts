import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { manejar, type Env, type Dependencias } from "../src/worker.ts";
import type { Persona } from "../src/sorteo.ts";

const PASSWORD = "contrasena-larga-123";
const PAUSA = 150; // debe coincidir con PAUSA_ENTRE_ENVIOS_MS del servidor

const personas: Persona[] = ["Ana", "Beto", "Carla", "Dani", "Eva", "Fran", "Gema", "Hugo"].map((n) => ({
  nombre: n,
  email: `${n.toLowerCase()}@ejemplo.com`,
}));
const base = { titulo: "Amigo invisible Familia Jorge", presupuesto: "20 €", fecha: "2027-01-06", personas };

interface Envio {
  url: string;
  cabeceras: Record<string, string>;
  cuerpo: { from: string; to: string[]; subject: string; html: string; text: string };
}
type RespuestaResend = { status: number; body?: unknown };

/** Monta un servidor de pruebas con KV y Resend de mentira. */
function montar(anioInicial = 2026) {
  const almacen = new Map<string, string>();
  const envios: Envio[] = [];
  const esperas: number[] = [];
  let contador = 0;
  let fecha = new Date(Date.UTC(anioInicial, 9, 18, 12));
  const resend = { responder: (_e: Envio, _n: number): RespuestaResend => ({ status: 200 }) };

  const env: Env = {
    HISTORIAL: {
      get: async (k) => almacen.get(k) ?? null,
      put: async (k, v) => {
        almacen.set(k, v);
      },
      delete: async (k) => {
        almacen.delete(k);
      },
    },
    RESEND_API_KEY: "re_clave_de_prueba",
    APP_PASSWORD: PASSWORD,
    REMITENTE: "Amigo invisible <sorteo@ejemplo.com>",
  };
  const deps: Dependencias = {
    fetch: async (url, init) => {
      const envio: Envio = { url, cabeceras: init.headers as Record<string, string>, cuerpo: JSON.parse(String(init.body)) };
      envios.push(envio);
      const r = resend.responder(envio, envios.length);
      return new Response(JSON.stringify(r.body ?? { id: "msg_1" }), { status: r.status });
    },
    ahora: () => fecha,
    esperar: async (ms) => {
      esperas.push(ms);
    },
    uuid: () => `sorteo-${++contador}`,
  };

  async function llamar(
    ruta: string,
    opc: { metodo?: string; cuerpo?: unknown; textoCrudo?: string; password?: string | null; autorizacion?: string } = {}
  ) {
    const { metodo = "POST", cuerpo, textoCrudo, password = PASSWORD, autorizacion } = opc;
    const cabeceras: Record<string, string> = { "content-type": "application/json" };
    // Igual que hacen la página y el script: la contraseña viaja con encodeURIComponent.
    if (autorizacion !== undefined) cabeceras.authorization = autorizacion;
    else if (password !== null) cabeceras.authorization = `Bearer ${encodeURIComponent(password)}`;
    const request = new Request(`https://amigo.ejemplo.com${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: metodo === "GET" ? undefined : (textoCrudo ?? (cuerpo === undefined ? undefined : JSON.stringify(cuerpo))),
    });
    const respuesta = await manejar(request, env, deps);
    const texto = await respuesta.text();
    let json: any = null;
    try {
      json = JSON.parse(texto);
    } catch {
      // no era JSON
    }
    return { status: respuesta.status, texto, json };
  }

  return { almacen, envios, esperas, resend, env, deps, llamar, fijarAnio: (a: number) => (fecha = new Date(Date.UTC(a, 9, 18, 12))) };
}

/** Deduce quién regala a quién leyendo los emails enviados (igual que haría cada persona). */
function reconstruir(envios: Envio[]): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const e of envios) {
    const dador = personas.find((p) => p.email === e.cuerpo.to[0])!;
    const nombrados = personas.filter((p) => p.email !== dador.email && e.cuerpo.text.includes(p.nombre));
    assert.equal(nombrados.length, 1, `el email de ${dador.nombre} debe nombrar exactamente a 1 persona`);
    if (resultado[dador.email]) assert.equal(resultado[dador.email], nombrados[0].email, "un reintento no puede cambiar el sorteo");
    resultado[dador.email] = nombrados[0].email;
  }
  return resultado;
}

function comprobarPermutacion(pares: Record<string, string>) {
  const dadores = Object.keys(pares).sort();
  const receptores = Object.values(pares).sort();
  assert.deepEqual(dadores, personas.map((p) => p.email).sort());
  assert.deepEqual(receptores, dadores, "cada persona recibe exactamente un regalo");
  for (const [d, r] of Object.entries(pares)) assert.notEqual(d, r, "nadie se regala a sí mismo");
}

const sinSecretos = (texto: string) => {
  assert.ok(!texto.includes("asignacion"));
  for (const p of personas) assert.ok(!texto.includes(p.nombre), `la respuesta no debe nombrar a ${p.nombre}`);
};

// ---------------------------------------------------------------------------

test("sin contraseña o con una incorrecta: 401 y no se envía nada", async () => {
  const t = montar();
  for (const password of [null, "incorrecta-incorrecta"]) {
    assert.equal((await t.llamar("/api/estado", { metodo: "GET", password })).status, 401);
  }
  const r = await t.llamar("/api/sortear", { cuerpo: base, password: "otra-contrasena-larga" });
  assert.equal(r.status, 401);
  assert.equal(t.envios.length, 0);
  assert.equal(t.almacen.size, 0);
});

test("si la contraseña configurada falta o es corta, el servidor se niega a funcionar", async () => {
  for (const mala of ["", "corta"]) {
    const t = montar();
    t.env.APP_PASSWORD = mala;
    const r = await t.llamar("/api/estado", { metodo: "GET", password: mala });
    assert.equal(r.status, 500);
  }
});

test("rutas desconocidas dan 404 y métodos equivocados 405", async () => {
  const t = montar();
  assert.equal((await t.llamar("/api/nada", { metodo: "GET" })).status, 404);
  assert.equal((await t.llamar("/api/sortear", { metodo: "GET" })).status, 405);
  assert.equal((await t.llamar("/api/estado", { metodo: "POST", cuerpo: {} })).status, 405);
  const fuera = await worker.fetch(new Request("https://amigo.ejemplo.com/otra-cosa"), t.env);
  assert.equal(fuera.status, 404);
});

test("estado inicial: sin años y sin sorteo a medias", async () => {
  const t = montar();
  const r = await t.llamar("/api/estado", { metodo: "GET" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { pendiente: null, anios: [] });
});

test("sorteo real: envía 8 emails, guarda el historial y no revela el resultado", async () => {
  const t = montar();
  const r = await t.llamar("/api/sortear", { cuerpo: base });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, enviados: 8 });
  sinSecretos(r.texto);
  for (const p of personas) assert.ok(!r.texto.includes(p.email));

  assert.equal(t.envios.length, 8);
  assert.equal(t.esperas.filter((ms) => ms === PAUSA).length, 7, "pausa entre envíos");
  const primero = t.envios[0];
  assert.equal(primero.url, "https://api.resend.com/emails");
  assert.equal(primero.cabeceras.authorization, "Bearer re_clave_de_prueba");
  assert.equal(primero.cuerpo.from, "Amigo invisible <sorteo@ejemplo.com>");
  assert.deepEqual(t.envios.map((e) => e.cuerpo.to[0]).sort(), personas.map((p) => p.email).sort());
  assert.ok(primero.cuerpo.text.includes("20 €"));
  assert.ok(primero.cuerpo.text.includes("6 de enero"));
  assert.ok(primero.cuerpo.html.includes("Amigo invisible Familia Jorge"));

  const pares = reconstruir(t.envios);
  comprobarPermutacion(pares);

  const historial = JSON.parse(t.almacen.get("historial")!);
  assert.equal(historial.length, 1);
  assert.equal(historial[0].anio, 2026);
  assert.deepEqual(historial[0].asignacion, pares);
  assert.ok(!t.almacen.has("pendiente"));

  const estado = await t.llamar("/api/estado", { metodo: "GET" });
  assert.deepEqual(estado.json, { pendiente: null, anios: [2026] });
  sinSecretos(estado.texto);
});

test("simulacro: comprueba que hay solución sin enviar ni guardar nada", async () => {
  const t = montar();
  const r = await t.llamar("/api/sortear", { cuerpo: { ...base, simulacro: true } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, simulacro: true, participantes: 8 });
  sinSecretos(r.texto);
  assert.equal(t.envios.length, 0);
  assert.equal(t.almacen.size, 0);
});

test("no repite pareja de los 2 años anteriores (50 veces, 3 años seguidos)", async () => {
  for (let vez = 0; vez < 50; vez++) {
    const t = montar();
    const porAnio: Record<string, string>[] = [];
    for (const anio of [2026, 2027, 2028]) {
      t.fijarAnio(anio);
      const antes = t.envios.length;
      const r = await t.llamar("/api/sortear", { cuerpo: base });
      assert.equal(r.status, 200);
      porAnio.push(reconstruir(t.envios.slice(antes)));
    }
    for (const dador of Object.keys(porAnio[2])) {
      assert.notEqual(porAnio[2][dador], porAnio[1][dador], "2028 repite a 2027");
      assert.notEqual(porAnio[2][dador], porAnio[0][dador], "2028 repite a 2026");
      assert.notEqual(porAnio[1][dador], porAnio[0][dador], "2027 repite a 2026");
    }
    const historial = JSON.parse(t.almacen.get("historial")!);
    assert.deepEqual(historial.map((h: { anio: number }) => h.anio), [2028, 2027], "solo se guardan 2 años");
    assert.ok(t.almacen.has("historial_anterior"), "queda copia de seguridad");
  }
});

test("un segundo sorteo del mismo año se rechaza; con «forzar» sustituye al anterior", async () => {
  const t = montar();
  await t.llamar("/api/sortear", { cuerpo: base });
  const antesDeRepetir = t.envios.length;

  const rechazado = await t.llamar("/api/sortear", { cuerpo: base });
  assert.equal(rechazado.status, 409);
  assert.equal(rechazado.json.error, "ya_hay_sorteo_este_anio");
  assert.equal(t.envios.length, antesDeRepetir, "no se envía nada");

  const forzado = await t.llamar("/api/sortear", { cuerpo: { ...base, forzar: true } });
  assert.equal(forzado.status, 200);
  assert.equal(t.envios.length, antesDeRepetir + 8);
  const historial = JSON.parse(t.almacen.get("historial")!);
  assert.equal(historial.length, 1, "sustituye, no acumula");
  assert.deepEqual(historial[0].asignacion, reconstruir(t.envios.slice(antesDeRepetir)));
});

test("si un email falla: el sorteo queda pendiente y «reintentar» solo reenvía a quien falló", async () => {
  const t = montar();
  t.resend.responder = (e) =>
    e.cuerpo.to[0] === "dani@ejemplo.com" ? { status: 422, body: { message: "The ejemplo.com domain is not verified." } } : { status: 200 };

  const r = await t.llamar("/api/sortear", { cuerpo: base });
  assert.equal(r.status, 502);
  assert.equal(r.json.error, "envio_incompleto");
  assert.equal(r.json.enviados, 7);
  assert.equal(r.json.total, 8);
  assert.deepEqual(r.json.fallos.map((f: { email: string }) => f.email), ["dani@ejemplo.com"]);
  assert.match(r.json.fallos[0].motivo, /not verified/);
  assert.equal(t.envios.length, 8, "un error permanente no se reintenta en bucle");
  assert.ok(t.almacen.has("pendiente"));
  assert.ok(!t.almacen.has("historial"), "no se confirma hasta que salgan todos");
  assert.equal(personas.filter((p) => r.texto.includes(p.email)).length, 1, "solo aparece el email que falló");
  assert.ok(!r.texto.includes("asignacion"));

  const estado = await t.llamar("/api/estado", { metodo: "GET" });
  assert.deepEqual(estado.json.pendiente, { enviados: 7, total: 8 });

  // Mientras haya un sorteo a medias, no se puede empezar otro.
  const bloqueado = await t.llamar("/api/sortear", { cuerpo: base });
  assert.equal(bloqueado.status, 409);
  assert.equal(bloqueado.json.error, "hay_sorteo_pendiente");
  assert.equal(t.envios.length, 8);

  // Se arregla el problema y se reintenta.
  t.resend.responder = () => ({ status: 200 });
  const reintento = await t.llamar("/api/reintentar");
  assert.equal(reintento.status, 200);
  assert.deepEqual(reintento.json, { ok: true, enviados: 8 });
  assert.equal(t.envios.length, 9, "solo se reenvía el de Dani");
  assert.equal(t.envios[8].cuerpo.to[0], "dani@ejemplo.com");

  const pares = reconstruir(t.envios); // además comprueba que el reintento no cambió el sorteo
  comprobarPermutacion(pares);
  assert.equal(t.envios[8].cabeceras["idempotency-key"], t.envios[3].cabeceras["idempotency-key"], "misma clave de idempotencia");
  assert.equal(new Set(t.envios.slice(0, 8).map((e) => e.cabeceras["idempotency-key"])).size, 8, "una clave distinta por persona");

  assert.ok(!t.almacen.has("pendiente"));
  assert.deepEqual(JSON.parse(t.almacen.get("historial")!)[0].asignacion, pares);
});

test("«descartar» borra el sorteo a medias y permite empezar de nuevo", async () => {
  const t = montar();
  t.resend.responder = (e) => (e.cuerpo.to[0] === "dani@ejemplo.com" ? { status: 403 } : { status: 200 });
  await t.llamar("/api/sortear", { cuerpo: base });
  assert.ok(t.almacen.has("pendiente"));

  const d = await t.llamar("/api/descartar-pendiente");
  assert.deepEqual(d.json, { ok: true });
  assert.ok(!t.almacen.has("pendiente"));

  t.resend.responder = () => ({ status: 200 });
  const r = await t.llamar("/api/sortear", { cuerpo: base });
  assert.equal(r.status, 200);

  assert.equal((await t.llamar("/api/reintentar")).status, 404, "ya no queda nada pendiente");
});

test("un límite de ritmo (429) se reintenta solo y el email sale una vez", async () => {
  const t = montar();
  t.resend.responder = (_e, n) => (n === 1 ? { status: 429 } : { status: 200 });
  const r = await t.llamar("/api/sortear", { cuerpo: base });
  assert.equal(r.status, 200);
  assert.equal(t.envios.length, 9, "8 emails + 1 intento rechazado");
  assert.ok(t.esperas.some((ms) => ms >= 1000), "espera antes de reintentar");
  comprobarPermutacion(reconstruir(t.envios));
});

test("si Resend se cae (500) tras 4 intentos se da por fallido y queda pendiente", async () => {
  const t = montar();
  t.resend.responder = (e) => (e.cuerpo.to[0] === "carla@ejemplo.com" ? { status: 500 } : { status: 200 });
  const r = await t.llamar("/api/sortear", { cuerpo: base });
  assert.equal(r.status, 502);
  assert.equal(t.envios.filter((e) => e.cuerpo.to[0] === "carla@ejemplo.com").length, 4);
  assert.equal(r.json.enviados, 7);
  assert.ok(t.almacen.has("pendiente"));
});

test("si no hay solución, responde 422 y no envía nada", async () => {
  const t = montar();
  const [a, b, c] = personas.slice(0, 3).map((p) => p.email);
  t.almacen.set(
    "historial",
    JSON.stringify([
      { anio: 2025, fecha: "2025-10-18", asignacion: { [a]: b, [b]: c, [c]: a } },
      { anio: 2024, fecha: "2024-10-18", asignacion: { [a]: c, [b]: a, [c]: b } },
    ])
  );
  const r = await t.llamar("/api/sortear", { cuerpo: { ...base, personas: personas.slice(0, 3) } });
  assert.equal(r.status, 422);
  assert.equal(r.json.error, "sorteo_imposible");
  assert.equal(t.envios.length, 0);
  assert.ok(!t.almacen.has("pendiente"));
});

test("un historial corrupto para en seco: no se envía nada ni se sobrescribe", async () => {
  const t = montar();
  t.almacen.set("historial", "{esto no es json");
  const r = await t.llamar("/api/sortear", { cuerpo: base });
  assert.equal(r.status, 500);
  assert.equal(t.envios.length, 0);
  assert.equal(t.almacen.get("historial"), "{esto no es json");
});

test("datos no válidos: 400 y no se envía ni se guarda nada", async () => {
  const casos: [string, unknown][] = [
    ["una sola persona", { ...base, personas: personas.slice(0, 1) }],
    ["email inválido", { ...base, personas: [...personas.slice(0, 7), { nombre: "Iris", email: "no-es-email" }] }],
    ["email repetido (da igual la mayúscula)", { ...base, personas: [...personas.slice(0, 7), { nombre: "Otra", email: "ANA@ejemplo.com" }] }],
    ["nombre vacío", { ...base, personas: [...personas.slice(0, 7), { nombre: "  ", email: "iris@ejemplo.com" }] }],
    ["31 participantes", { ...base, personas: Array.from({ length: 31 }, (_, i) => ({ nombre: `P${i}`, email: `p${i}@ejemplo.com` })) }],
    ["fecha imaginaria", { ...base, fecha: "2027-02-30" }],
    ["fecha con formato raro", { ...base, fecha: "6 de enero" }],
    ["título larguísimo", { ...base, titulo: "x".repeat(200) }],
    ["participantes que no es una lista", { ...base, personas: "Ana, Beto" }],
  ];
  for (const [descripcion, cuerpo] of casos) {
    const t = montar();
    const r = await t.llamar("/api/sortear", { cuerpo });
    assert.equal(r.status, 400, descripcion);
    assert.equal(t.envios.length, 0, descripcion);
    assert.equal(t.almacen.size, 0, descripcion);
  }
  const t = montar();
  assert.equal((await t.llamar("/api/sortear", { textoCrudo: "esto no es json" })).status, 400);
  assert.equal(t.envios.length, 0);
});

test("saltos de línea en el título no pueden colarse en el asunto del email", async () => {
  const t = montar();
  const r = await t.llamar("/api/sortear", { cuerpo: { ...base, titulo: "Hola\r\nBcc: malo@ejemplo.com" } });
  assert.equal(r.status, 200);
  assert.ok(t.envios.every((e) => !/[\r\n]/.test(e.cuerpo.subject)));
});

test("prueba de envío: manda un email de ejemplo y no toca el historial", async () => {
  const t = montar();
  const r = await t.llamar("/api/prueba-envio", { cuerpo: { destino: "yo@ejemplo.com" } });
  assert.deepEqual(r.json, { ok: true });
  assert.equal(t.envios.length, 1);
  assert.deepEqual(t.envios[0].cuerpo.to, ["yo@ejemplo.com"]);
  assert.match(t.envios[0].cuerpo.subject, /PRUEBA/);
  assert.equal(t.almacen.size, 0);

  assert.equal((await t.llamar("/api/prueba-envio", { cuerpo: { destino: "no-es-email" } })).status, 400);
  assert.equal((await t.llamar("/api/prueba-envio", { cuerpo: {} })).status, 400);
  assert.equal(t.envios.length, 1);
});

test("prueba de envío con el dominio sin verificar: cuenta el motivo", async () => {
  const t = montar();
  t.resend.responder = () => ({ status: 403, body: { message: "The ejemplo.com domain is not verified." } });
  const r = await t.llamar("/api/prueba-envio", { cuerpo: { destino: "yo@ejemplo.com" } });
  assert.equal(r.status, 502);
  assert.match(r.json.mensaje, /not verified/);
  assert.equal(t.envios.length, 1, "un 403 no se reintenta");
});

test("la contraseña puede llevar ñ, tildes, símbolos y espacios (viaja codificada)", async () => {
  const t = montar();
  const clave = "Contraseña ñandú 100% #segura €";
  t.env.APP_PASSWORD = clave;
  assert.equal((await t.llamar("/api/estado", { metodo: "GET", password: clave })).status, 200);
  assert.equal((await t.llamar("/api/estado", { metodo: "GET", password: "Contrasena nandu 100% #segura E" })).status, 401);
});

test("una cabecera de autorización mal formada da 401, no un error del servidor", async () => {
  const t = montar();
  for (const raro of ["Bearer %E0%A4%A", "Bearer %", "Basic abc", "Bearer ", ""]) {
    const r = await t.llamar("/api/estado", { metodo: "GET", autorizacion: raro });
    assert.equal(r.status, 401, `«${raro}»`);
  }
});