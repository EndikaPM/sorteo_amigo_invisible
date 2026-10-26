# 👻 Amigo invisible

Web privada para organizar el amigo invisible de la familia una vez al año. Rellenas los participantes desde el móvil, el servidor hace el sorteo y envía por email a cada persona a quién le toca regalar. **Nadie ve el resultado, ni quien organiza.**

Funciona sobre Cloudflare Workers (plan gratuito), sin base de datos y sin servidor propio. Los emails salen con [Resend](https://resend.com) desde un dominio propio.

## Qué hace

- Formulario web (modo oscuro, tema Dracula, fuente Comfortaa) con título, presupuesto, fecha y participantes. Sirven 7, 8, 9... hasta 30 personas.
- Sorteo aleatorio con aleatoriedad criptográfica. Nadie se toca a sí mismo y **no se repiten las parejas de los 2 años anteriores**.
- Email en HTML (con versión en texto) para cada persona.
- El resultado **nunca viaja a la web**: la página solo muestra «se han enviado N emails».
- Historial guardado en Cloudflare KV (un JSON interno que nadie ve). Se conservan los 2 últimos años.
- «Comprobar sin enviar»: verifica que existe un reparto válido sin mandar ni guardar nada.
- Protección contra fallos a mitad de envío: el sorteo queda guardado como pendiente y se puede **reintentar** sin volver a sortear, de modo que nadie recibe dos asignaciones distintas.
- Acceso protegido con una contraseña única.

## Cómo funciona

```
iPhone / navegador ──► Cloudflare Worker ──► Resend ──► email de cada participante
     (web/)              (src/worker.ts)
                              │
                              └─► Cloudflare KV (historial + sorteo pendiente)
```

| Ruta | Para qué |
|---|---|
| `GET /api/estado` | Años guardados y si hay un sorteo a medias |
| `POST /api/sortear` | Sortea y envía (o solo comprueba con `simulacro: true`) |
| `POST /api/reintentar` | Termina los envíos de un sorteo pendiente |
| `POST /api/descartar-pendiente` | Olvida un sorteo pendiente para empezar de cero |
| `POST /api/prueba-envio` | Manda un email de prueba a una dirección |

Todas piden la contraseña en la cabecera `Authorization: Bearer ...`.

## Estructura

```
src/
  worker.ts     API, contraseña, historial y envío
  sorteo.ts     algoritmo del sorteo y actualización del historial
  email.ts      plantilla del email (HTML + texto)
  fechas.ts     utilidades de fechas
web/            la página que se publica (index.html, iconos...)
scripts/
  prueba-envio.ts   email de prueba real contra el servidor local
test/           pruebas automáticas
wrangler.toml   configuración de Cloudflare
```

## Requisitos

- Node.js 22 o superior (el proyecto ejecuta TypeScript directamente).
- Cuenta gratuita de [Cloudflare](https://dash.cloudflare.com).
- Cuenta de [Resend](https://resend.com) con un dominio verificado.

## Probar en local

```bash
npm install
cp .dev.vars.example .dev.vars   # y rellena APP_PASSWORD y RESEND_API_KEY
npm run dev                      # http://127.0.0.1:8787
```

Notas importantes:

- `APP_PASSWORD`: mínimo 12 caracteres. Mejor solo letras, números y guiones. Si lleva `#`, ponla entre comillas.
- **Si cambias `.dev.vars` o el código, para el servidor (Ctrl+C) y vuelve a lanzar `npm run dev`.** No se recarga solo.
- En local, «Sortear y enviar» **envía emails de verdad**. Pruébalo con tus propios correos.
- Para enviar un email de prueba rápido (con el servidor en marcha en otra terminal):

```bash
npm run prueba-envio -- tu@correo.com
```

## Publicar en Cloudflare

1. En `wrangler.toml`, cambia `REMITENTE` por una dirección de tu dominio verificado en Resend y ajusta `routes` con tu dominio.
2. Inicia sesión y crea el almacén del historial:

```bash
npx wrangler login
npx wrangler kv namespace create HISTORIAL   # copia el id en wrangler.toml
```

3. Sube el proyecto:

```bash
npm run deploy
```

4. Guarda los secretos (no se ven al escribirlos):

```bash
npx wrangler secret put APP_PASSWORD
npx wrangler secret put RESEND_API_KEY
```

5. Abre tu dominio, entra con la contraseña y haz primero un sorteo de prueba con tus propios correos.

Cada vez que cambies algo en `web/` o `src/`, vuelve a ejecutar `npm run deploy`.

## Uso cada año

1. Abre la web, entra con la contraseña.
2. Revisa título, presupuesto y fecha. Rellena nombre y email de cada participante.
3. Pulsa «Comprobar sin enviar» y después «Sortear y enviar emails».
4. Pasados unos minutos, mira en el panel de Resend que no haya emails rebotados.

Si algún envío falla, la web lo indica y ofrece **Reintentar**. No hace falta volver a sortear.

## Pruebas

```bash
npm test
```

Cubren el algoritmo del sorteo (incluida su uniformidad), las fechas y toda la API con un Resend y un KV simulados.

## Seguridad y privacidad

- Un solo acceso por contraseña, guardada como secreto de Cloudflare. Elige una larga y distinta a las de tus otras cuentas.
- `.dev.vars` contiene claves reales: **no lo subas a Git** (ya está en `.gitignore`).
- La web lleva `noindex` para que los buscadores no la indexen.
- El reparto no se devuelve nunca por la API ni se muestra en pantalla; solo llega por email a cada persona.
- El historial se guarda en KV con las direcciones de email en minúsculas.
- Si quieres reforzar el acceso más adelante, puedes añadir [Cloudflare Access](https://www.cloudflare.com/zero-trust/products/access/) delante de la web.

## Licencia

[MIT](LICENSE)
