// Genera preview-email.html para ver cómo queda el email en el navegador.
import { writeFileSync } from "node:fs";
import { generarEmail } from "./src/email.ts";
import { proximosReyes, formatoFecha } from "./src/fechas.ts";

const anioActual = new Date().getFullYear();

const fechaReyes = formatoFecha(proximosReyes());

const { html, texto, asunto } = generarEmail({
  nombreDador: "Ana",
  nombreReceptor: "Beto",
  titulo: `&#128123; Amigo invisible Familia Jorge ${anioActual}`,
  presupuesto: "20 €",
  fecha: fechaReyes,
  emailReceptor: "beto@ejemplo.com",
});

writeFileSync("preview-email.html", html);
console.log("Asunto:", asunto);
console.log("\n--- Versión en texto ---\n" + texto);
