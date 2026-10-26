// Manda un email de prueba REAL a la dirección que indiques, usando el servidor que corre en tu PC.
//
// Uso (el servidor debe estar en marcha en otra terminal con "npm run dev"):
//   npm run prueba-envio -- tu@correo.com

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

function salir(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

function leerArchivo(ruta: string): string | null {
  try {
    return readFileSync(ruta, "utf8");
  } catch {
    return null;
  }
}

const destino = process.argv[2];
if (!destino) {
  salir("Falta el correo de destino.\nUso: npm run prueba-envio -- tu@correo.com");
}
if (!destino.includes("@")) {
  salir(`«${destino}» no parece un correo electrónico.\nUso: npm run prueba-envio -- tu@correo.com`);
}

// 1) Comprobaciones de configuración, antes de tocar nada
const vars = leerArchivo(".dev.vars");
if (vars === null) {
  salir('No encuentro el archivo ".dev.vars". Cópialo desde ".dev.vars.example" (sin el ".example") y rellénalo.');
}
// Se lee igual que lo hace Wrangler (formato .env): un # sin comillas empieza un comentario.
const env = parseEnv(vars);
const password = env.APP_PASSWORD;
const claveResend = env.RESEND_API_KEY;
const hayAlmohadilla = /^\s*APP_PASSWORD\s*=\s*[^"'\s][^"']*#/m.test(vars);

if (!password || password === "pon-aqui-una-frase-larga") {
  salir('Falta poner tu contraseña en ".dev.vars" (línea APP_PASSWORD).');
}
if (password.length < 12) {
  salir(
    `La contraseña de ".dev.vars" tiene solo ${password.length} caracteres tal y como la lee el servidor (mínimo 12).` +
    (hayAlmohadilla
      ? '\nOjo: en ese archivo el símbolo # empieza un comentario, y lo que va detrás no cuenta. Quita el # o pon la contraseña entre comillas: APP_PASSWORD="mi frase#larga"'
      : "")
  );
}
if (hayAlmohadilla) {
  console.warn(
    `⚠ En ".dev.vars" el # de APP_PASSWORD empieza un comentario: la contraseña real tiene ${password.length} caracteres. Mejor quita el # o pon la contraseña entre comillas.`
  );
}
if (!claveResend || claveResend === "re_pon_aqui_tu_clave") {
  salir('Falta poner tu clave de Resend en ".dev.vars" (línea RESEND_API_KEY).');
}
if (env.RESEND_URL) {
  salir('En ".dev.vars" está activa la línea RESEND_URL (modo de pruebas falso: no enviaría nada de verdad). Bórrala o ponle # delante.');
}
const toml = leerArchivo("wrangler.toml") ?? "";
const remitente = /^\s*REMITENTE\s*=\s*"(.*)"/m.exec(toml)?.[1];
if (!remitente || remitente.includes("TU-DOMINIO")) {
  salir('Cambia "TU-DOMINIO.com" en wrangler.toml por tu dominio verificado en Resend. Por ejemplo:\nREMITENTE = "Amigo invisible <sorteo@midominio.com>"');
}

// 2) Petición al servidor local
const base = process.env.SERVIDOR ?? "http://127.0.0.1:8787";
console.log(`Enviando un email de prueba a ${destino} desde ${remitente} ...`);

let respuesta: Response;
try {
  respuesta = await fetch(`${base}/api/prueba-envio`, {
    method: "POST",
    // La contraseña se codifica para que ñ, tildes y símbolos viajen bien en la cabecera.
    headers: { authorization: `Bearer ${encodeURIComponent(password)}`, "content-type": "application/json" },
    body: JSON.stringify({ destino }),
  });
} catch {
  salir(`No puedo conectar con el servidor en ${base}.\n¿Está en marcha? Abre otra terminal en esta carpeta y ejecuta: npm run dev`);
}

// 3) Resultado, con pistas si algo falla
const datos = (await respuesta.json().catch(() => null)) as { mensaje?: string; error?: string } | null;
if (respuesta.ok) {
  console.log(`✔ Enviado. Mira la bandeja de entrada de ${destino} (y la carpeta de spam, por si acaso).`);
  process.exit(0);
}

const detalle = datos?.mensaje ?? datos?.error ?? "error desconocido";
console.error(`✘ No se ha podido enviar (${respuesta.status}): ${detalle}`);
if (respuesta.status === 401) {
  console.error(
    `→ El servidor no reconoce la contraseña (el script leyó ${password.length} caracteres de ".dev.vars").\n` +
    "  Lo más habitual: cambiaste \".dev.vars\" con el servidor encendido, y Wrangler no lo recarga solo.\n" +
    "  Para el servidor (Ctrl + C) y arráncalo otra vez con: npm run dev"
  );
} else if (/domain|verified|verific/i.test(detalle)) {
  console.error("→ Resend dice que el dominio no está verificado o que el remitente no es de tu dominio. Mira en resend.com → Domains que pone «Verified», y que el dominio de REMITENTE en wrangler.toml es exactamente ese.");
} else if (/api key|restricted|Resend (401|403)/i.test(detalle)) {
  console.error("→ La clave de Resend no es válida o no tiene permiso. Crea una nueva en resend.com → API Keys (permiso «Sending access») y ponla en .dev.vars. Después, para el servidor (Ctrl + C) y vuelve a arrancarlo.");
}
process.exit(1);