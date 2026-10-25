// Servidor local SOLO para probar la página en tu PC (npm start). No se usa en producción.
// Sirve public/index.html y convierte al vuelo los archivos src/*.ts a JavaScript para el navegador.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";

const PUERTO = Number(process.env.PORT ?? 3000);
const raiz = import.meta.dirname;

const servidor = createServer((req, res) => {
  const ruta = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    if (ruta === "/" || ruta === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(join(raiz, "public", "index.html")));
      return;
    }
    // /src/sorteo.js -> src/sorteo.ts (solo letras minúsculas: no se puede salir de la carpeta)
    const m = /^\/src\/([a-z]+)\.js$/.exec(ruta);
    if (m) {
      const codigo = readFileSync(join(raiz, "src", `${m[1]}.ts`), "utf8");
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(stripTypeScriptTypes(codigo));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("No encontrado");
  }
});

servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log(`Página de pruebas lista: abre http://localhost:${PUERTO} en tu navegador`);
  console.log("Para parar el servidor: Ctrl + C");
});
