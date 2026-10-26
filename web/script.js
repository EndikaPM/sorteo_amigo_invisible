const $ = (id) => document.getElementById(id);
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PERSONAS = 30;

// --- Contraseña: solo en memoria (y en la sesión de la pestaña, si el navegador lo permite) ---
let clave = "";
try { clave = sessionStorage.getItem("clave") ?? ""; } catch {}
function guardarClave(v) {
  clave = v;
  try { v ? sessionStorage.setItem("clave", v) : sessionStorage.removeItem("clave"); } catch {}
}

// --- Llamadas al servidor ---
async function api(ruta, metodo, cuerpo) {
  let r;
  try {
    r = await fetch(ruta, {
      method: metodo,
      headers: {
        // encodeURIComponent: así ñ, tildes y símbolos viajan bien en la cabecera
        authorization: "Bearer " + encodeURIComponent(clave),
        ...(cuerpo ? { "content-type": "application/json" } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    return { estado: 0, datos: { mensaje: "No hay conexión con el servidor. Revisa internet y vuelve a intentarlo." } };
  }
  const datos = await r.json().catch(() => ({}));
  return { estado: r.status, datos };
}

// --- Fechas (hora local, sin saltos por UTC) ---
const dosDig = (n) => String(n).padStart(2, "0");
const aISO = (d) => `${d.getFullYear()}-${dosDig(d.getMonth() + 1)}-${dosDig(d.getDate())}`;
function proximosReyes() {
  const hoy = new Date();
  const hoy0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const reyes = new Date(hoy.getFullYear(), 0, 6);
  return reyes >= hoy0 ? reyes : new Date(hoy.getFullYear() + 1, 0, 6);
}

// --- Lista de participantes ---
const lista = $("lista");

function contar() {
  let n = 0;
  lista.querySelectorAll(".persona").forEach((f) => {
    if (f.querySelector(".nombre").value.trim() || f.querySelector(".email").value.trim()) n++;
  });
  return n;
}
function actualizarContador() {
  const n = contar();
  $("contador").textContent = `${n} participante${n === 1 ? "" : "s"}`;
}

function nuevaFila() {
  const fila = document.createElement("div");
  fila.className = "persona";

  const n = document.createElement("input");
  n.type = "text"; n.className = "nombre"; n.placeholder = "Nombre"; n.maxLength = 60;
  n.autocomplete = "off"; n.setAttribute("aria-label", "Nombre");

  const e = document.createElement("input");
  e.type = "email"; e.className = "email"; e.placeholder = "Email"; e.maxLength = 254;
  e.inputMode = "email"; e.autocapitalize = "none"; e.autocomplete = "off"; e.setAttribute("aria-label", "Email");

  const x = document.createElement("button");
  x.type = "button"; x.className = "quitar"; x.textContent = "✕";
  x.setAttribute("aria-label", "Quitar persona");
  x.addEventListener("click", () => { fila.remove(); actualizarContador(); });

  fila.append(n, e, x);
  lista.append(fila);
  return fila;
}
lista.addEventListener("input", actualizarContador);
$("anadir").addEventListener("click", () => {
  if (lista.children.length >= MAX_PERSONAS) return mostrar("error", `Como máximo ${MAX_PERSONAS} personas.`);
  nuevaFila().querySelector(".nombre").focus();
  actualizarContador();
});

function leerPersonas() {
  const personas = [], errores = [], vistos = new Set();
  lista.querySelectorAll(".persona").forEach((fila, i) => {
    const nombre = fila.querySelector(".nombre").value.trim();
    const email = fila.querySelector(".email").value.trim();
    if (!nombre && !email) return;
    if (!nombre) return errores.push(`Fila ${i + 1}: falta el nombre.`);
    if (!REGEX_EMAIL.test(email)) return errores.push(`Fila ${i + 1} (${nombre}): el email no es válido.`);
    const k = email.toLowerCase();
    if (vistos.has(k)) return errores.push(`Fila ${i + 1} (${nombre}): ese email ya está en otra fila.`);
    vistos.add(k);
    personas.push({ nombre, email });
  });
  if (!errores.length && personas.length < 2) errores.push("Hacen falta al menos 2 participantes.");
  return { personas, errores };
}

// --- Mensajes y estado de la interfaz ---
function mostrar(tipo, texto) {
  const m = $("mensaje");
  m.className = "mensaje " + tipo;
  m.textContent = texto;
  m.hidden = false;
  m.scrollIntoView({ behavior: "smooth", block: "center" });
}
const ocultarMensaje = () => { $("mensaje").hidden = true; };

let ocupado = false;
function bloquear(v) {
  ocupado = v;
  for (const id of ["simulacro", "sortear", "reintentar", "descartar", "anadir"]) $(id).disabled = v;
}

function mostrarEntrada(error) {
  $("pantallaSorteo").hidden = true;
  $("pantallaEntrada").hidden = false;
  $("errorEntrada").hidden = !error;
  if (error) $("errorEntrada").textContent = error;
  $("clave").focus();
}

// --- Estado del servidor (sorteo a medias, años guardados) ---
let aniosGuardados = [];
async function cargarEstado() {
  const { estado, datos } = await api("/api/estado", "GET");
  if (estado === 401) { guardarClave(""); mostrarEntrada("Contraseña incorrecta."); return false; }
  if (estado !== 200) { mostrarEntrada(datos.mensaje || "No se pudo conectar con el servidor."); return false; }
  aniosGuardados = datos.anios || [];
  const p = datos.pendiente;
  $("pendiente").hidden = !p;
  if (p) {
    $("textoPendiente").textContent =
      `Hay un sorteo a medias: se han enviado ${p.enviados} de ${p.total} emails. ` +
      `No hace falta sortear otra vez: reintenta los envíos que faltan.`;
  }
  return true;
}

async function abrirSorteo() {
  if (!(await cargarEstado())) return;
  $("pantallaEntrada").hidden = true;
  $("pantallaSorteo").hidden = false;
}

// --- Entrada ---
$("formEntrada").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("errorEntrada").hidden = true;
  guardarClave($("clave").value);
  $("entrar").disabled = true;
  await abrirSorteo();
  $("entrar").disabled = false;
  $("clave").value = "";
});
$("cerrar").addEventListener("click", () => { guardarClave(""); ocultarMensaje(); mostrarEntrada(); });

// --- Sortear ---
function datosFormulario(personas, extra) {
  return {
    titulo: $("titulo").value.trim(),
    presupuesto: $("presupuesto").value.trim(),
    fecha: $("fecha").value,
    personas,
    ...extra,
  };
}

function describirFallo(estado, datos) {
  if (estado === 401) { guardarClave(""); mostrarEntrada("La contraseña ya no es válida. Entra otra vez."); return null; }
  let t = datos.mensaje || "Algo ha fallado.";
  if (datos.error === "envio_incompleto") {
    t += `\nSalieron ${datos.enviados} de ${datos.total}.`;
    if (datos.fallos?.length) t += "\nNo salieron para: " + datos.fallos.map((f) => f.email).join(", ") + ".";
  }
  return t;
}

async function lanzar(simulacro, forzar = false) {
  ocultarMensaje();
  const { personas, errores } = leerPersonas();
  if (errores.length) return mostrar("error", errores.join("\n"));

  if (!simulacro && !forzar &&
      !confirm(`Se va a sortear y enviar ${personas.length} emails. No se puede deshacer. ¿Seguro?`)) return;

  bloquear(true);
  const { estado, datos } = await api("/api/sortear", "POST", datosFormulario(personas, { simulacro, forzar }));
  bloquear(false);

  if (estado === 200 && simulacro) {
    return mostrar("ok", `Todo en orden: con estos ${datos.participantes} participantes hay reparto posible. No se ha enviado nada.`);
  }
  if (estado === 200) {
    await cargarEstado();
    return mostrar("ok", `¡Listo! Se han enviado ${datos.enviados} emails. Cada persona sabe a quién le toca; tú no.`);
  }
  if (datos.error === "ya_hay_sorteo_este_anio") {
    if (confirm(datos.mensaje + "\n\nSi continúas, se rehace y se envían los emails otra vez. ¿Rehacer el sorteo?")) return lanzar(false, true);
    return;
  }
  if (datos.error === "envio_incompleto" || datos.error === "hay_sorteo_pendiente") await cargarEstado();
  const t = describirFallo(estado, datos);
  if (t) mostrar("error", t);
}
$("simulacro").addEventListener("click", () => lanzar(true));
$("sortear").addEventListener("click", () => lanzar(false));

// --- Sorteo a medias ---
$("reintentar").addEventListener("click", async () => {
  ocultarMensaje();
  bloquear(true);
  const { estado, datos } = await api("/api/reintentar", "POST", {});
  bloquear(false);
  await cargarEstado();
  if (estado === 200) return mostrar("ok", `¡Listo! Se han enviado los ${datos.enviados} emails.`);
  const t = describirFallo(estado, datos);
  if (t) mostrar("error", t);
});
$("descartar").addEventListener("click", async () => {
  if (!confirm("Se olvida el sorteo a medias y podrás empezar de cero. Los que ya recibieron su email tendrán uno que ya no vale. ¿Descartar?")) return;
  bloquear(true);
  const { estado, datos } = await api("/api/descartar-pendiente", "POST", {});
  bloquear(false);
  await cargarEstado();
  if (estado !== 200) { const t = describirFallo(estado, datos); if (t) mostrar("error", t); }
  else mostrar("aviso", "Sorteo a medias descartado. Puedes empezar de nuevo.");
});

// --- Arranque ---
$("titulo").value = `Amigo invisible ${new Date().getFullYear()}`;
$("fecha").value = aISO(proximosReyes());
for (let i = 0; i < 8; i++) nuevaFila();
actualizarContador();
if (clave) abrirSorteo(); else $("clave").focus();
