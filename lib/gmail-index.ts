export type GmailHeader = { name: string; value: string };
export type GmailMessage = {
  id: string;
  internalDate?: string;
  historyId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
};

export type MessageCategory = "Publicidad" | "Newsletters" | "Notificaciones";

export function gmailHeader(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";
}

export function senderFrom(value: string) {
  const match = value.match(/^(?:"?([^"<]+)"?\s*)?<([^>]+)>$/);
  const email = (match?.[2] ?? value).trim().toLowerCase();
  const name = (match?.[1] ?? email.split("@")[0] ?? email).trim();
  return { email, name };
}

export function categoryFor(message: GmailMessage, from: string): MessageCategory {
  const unsubscribe = gmailHeader(message, "List-Unsubscribe");
  const precedence = gmailHeader(message, "Precedence").toLowerCase();
  const subject = gmailHeader(message, "Subject");
  const value = `${from} ${subject} ${message.snippet ?? ""} ${precedence}`.toLowerCase();
  const labels = new Set(message.labelIds ?? []);
  const transactional = /recibo|factura|pedido|orden|compra confirmada|confirmaci[oó]n|contrase[nñ]a|c[oó]digo|verificaci[oó]n|seguridad|env[ií]o|entrega|receipt|invoice|order|password|verification|security|shipped|delivered/.test(value);
  const promotional = /oferta|descuento|promoci[oó]n|cup[oó]n|rebaja|ahorra|compra ahora|env[ií]o gratis|precio especial|solo hoy|última oportunidad|sale|discount|promo|coupon|save \d|shop now|free shipping|special price|limited time|deal|% off|temu|aliexpress/.test(value);
  const editorial = /newsletter|bolet[ií]n|resumen|semanal|diario|novedades|noticias|digest|weekly|daily|insights|roundup/.test(value);

  if (transactional && !promotional) return "Notificaciones";
  if (labels.has("CATEGORY_PROMOTIONS") || promotional) return "Publicidad";
  if (labels.has("CATEGORY_UPDATES") || labels.has("CATEGORY_SOCIAL") || labels.has("CATEGORY_FORUMS")) return "Notificaciones";
  if (editorial || unsubscribe || /bulk|list/.test(precedence)) return "Newsletters";
  return "Notificaciones";
}

export function indexedMessageValues(accountEmail: string, message: GmailMessage) {
  const fromValue = gmailHeader(message, "From");
  if (!fromValue) return null;
  const sender = senderFrom(fromValue);
  return {
    id: `${accountEmail}:${message.id}`,
    accountEmail,
    messageId: message.id,
    senderEmail: sender.email,
    senderName: sender.name,
    senderDomain: sender.email.split("@")[1] ?? sender.email,
    subject: gmailHeader(message, "Subject"),
    snippet: message.snippet ?? "",
    category: categoryFor(message, fromValue),
    receivedAt: Number(message.internalDate ?? 0),
    hasUnsubscribe: Boolean(gmailHeader(message, "List-Unsubscribe")),
    indexedAt: Date.now(),
  };
}
