// Plantilla del email: HTML con estilos en línea y tablas (compatible con Gmail, Outlook y Apple Mail)
// más una versión en texto plano.

export interface DatosEmail {
  /** Nombre de quien recibe el email (el que regala). */
  nombreDador: string;
  /** Nombre de la persona a la que le toca regalar. */
  nombreReceptor: string;
  /** Texto libre, p. ej. "20 €". Opcional. */
  presupuesto?: string;
  /** Texto libre, p. ej. "sábado 20 de diciembre". Opcional. */
  fecha?: string;
  /** Nombre del evento, p. ej. "Amigo invisible 2026". */
  titulo?: string;
  /**Email del receptor  */
  emailReceptor?: string;
}

export interface EmailGenerado {
  asunto: string;
  html: string;
  texto: string;
}

function escapar(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generarEmail(d: DatosEmail): EmailGenerado {
  const titulo = d.titulo ?? "Amigo invisible";
  const dador = escapar(d.nombreDador);
  const receptor = escapar(d.nombreReceptor);
  const emailReceptor = d.emailReceptor ? escapar(d.emailReceptor) : "";  

  const filasDetalle: string[] = [];
  if (d.presupuesto) {
    filasDetalle.push(
      `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Presupuesto</td>` +
      `<td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${escapar(d.presupuesto)}</td></tr>`
    );
  }
  if (d.fecha) {
    filasDetalle.push(
      `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;">Fecha</td>` +
      `<td style="padding:6px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;">${escapar(d.fecha)}</td></tr>`
    );
  }
  const bloqueDetalle = filasDetalle.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #e5e7eb;">${filasDetalle.join("")}</table>`
    : "";

  const html = `<!doctype html>
                <html lang="es">
                <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <meta name="color-scheme" content="light dark">
                <title>${escapar(titulo)}</title>
                </head>
                <body style="margin:0;padding:0;background-color:#f3f4f6;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">
                  <tr>
                    <td align="center" style="padding:24px 12px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:12px;">
                        <tr>
                          <td align="center" style="padding:28px 24px;background-color:#b91c1c;border-radius:12px 12px 0 0;">
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:36px;line-height:40px;">&#127873;</div>
                            <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:700;color:#ffffff;margin-top:8px;">${escapar(titulo)}</div>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding:28px 24px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
                            <p style="margin:0 0 16px 0;font-size:16px;line-height:24px;">&iexcl;Hola, ${dador}!</p>
                            <p style="margin:0 0 20px 0;font-size:16px;line-height:24px;">Ha salido el sorteo. Te toca regalar a:</p>
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td align="center" style="padding:20px 12px;background-color:#fef2f2;border:2px dashed #b91c1c;border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:32px;font-weight:700;color:#b91c1c;">${receptor}<br>${emailReceptor}</td>
                              </tr>
                            </table>
                            ${bloqueDetalle}
                            <p style="margin:24px 0 0 0;font-size:14px;line-height:21px;color:#6b7280;">&iexcl;Que sea un secreto! No se lo cuentes a nadie.</p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                </body>
                </html>`;

  const lineasTexto = [`¡Hola, ${d.nombreDador}!`, "", "Ha salido el sorteo. Te toca regalar a:", "", `${d.nombreReceptor}`, "", `${d.emailReceptor ?? ""}`];
  if (d.presupuesto) lineasTexto.push(`Presupuesto: ${d.presupuesto}`);
  if (d.fecha) lineasTexto.push(`Fecha: ${d.fecha}`);
  lineasTexto.push("", "¡Que sea un secreto! No se lo cuentes a nadie.");

  return {
    asunto: `${titulo}: ya sabes a quién regalar`,
    html,
    texto: lineasTexto.join("\n"),
  };
}
