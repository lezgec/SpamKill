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
export type ManualCategory = MessageCategory | "Phishing o Spam";
export type ClassificationReason =
  | "transactional_terms"
  | "gmail_promotions"
  | "promotional_terms"
  | "gmail_categories"
  | "editorial_terms"
  | "unsubscribe_header"
  | "unsubscribe_content"
  | "no_signals"
  | "legacy_classification";
export type ClassificationConfidence = "high" | "medium" | "low";
export type Classification = {
  category: MessageCategory;
  reason: ClassificationReason;
  confidence: ClassificationConfidence;
};

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

export function classificationFor(message: GmailMessage, from: string): Classification {
  const unsubscribe = gmailHeader(message, "List-Unsubscribe");
  const precedence = gmailHeader(message, "Precedence").toLowerCase();
  const subject = gmailHeader(message, "Subject");
  const value = `${from} ${subject} ${message.snippet ?? ""} ${precedence}`.toLowerCase();
  const labels = new Set(message.labelIds ?? []);
  const transactional = /recibo|factura|pedido|orden|compra confirmada|confirmaci[oó]n|contrase[nñ]a|c[oó]digo|verificaci[oó]n|seguridad|env[ií]o|entrega|receipt|invoice|order|password|verification|security|shipped|delivered/.test(value);
  const promotional = /oferta|descuento|promoci[oó]n|cup[oó]n|rebaja|ahorra|compra ahora|env[ií]o gratis|precio especial|solo hoy|última oportunidad|sale|discount|promo|coupon|save \d|shop now|free shipping|special price|limited time|deal|% off|temu|aliexpress/.test(value);
  const editorial = /newsletter|bolet[ií]n|resumen|semanal|diario|novedades|noticias|digest|weekly|daily|insights|roundup/.test(value);
  const contentUnsubscribe = /unsubscribe|opt[\s-]?out|cancelar\s+(?:la\s+)?suscripci[oó]n|darse\s+de\s+baja|desuscrib|dejar\s+de\s+recibir|manage\s+(?:email\s+)?preferences|preferencias\s+(?:de\s+)?(?:correo|comunicaci[oó]n|suscripci[oó]n)/i.test(message.snippet ?? "");

  if (transactional && !promotional) {
    return { category: "Notificaciones", reason: "transactional_terms", confidence: "high" };
  }
  if (labels.has("CATEGORY_PROMOTIONS")) {
    return { category: "Publicidad", reason: "gmail_promotions", confidence: "high" };
  }
  if (promotional) {
    return { category: "Publicidad", reason: "promotional_terms", confidence: "high" };
  }
  if (labels.has("CATEGORY_UPDATES") || labels.has("CATEGORY_SOCIAL") || labels.has("CATEGORY_FORUMS")) {
    return { category: "Notificaciones", reason: "gmail_categories", confidence: "high" };
  }
  if (editorial) {
    return { category: "Newsletters", reason: "editorial_terms", confidence: "high" };
  }
  if (unsubscribe || /bulk|list/.test(precedence)) {
    return { category: "Newsletters", reason: "unsubscribe_header", confidence: "medium" };
  }
  if (contentUnsubscribe) {
    return { category: "Newsletters", reason: "unsubscribe_content", confidence: "medium" };
  }
  return { category: "Notificaciones", reason: "no_signals", confidence: "low" };
}

export function categoryFor(message: GmailMessage, from: string): MessageCategory {
  return classificationFor(message, from).category;
}

export function classificationReasonText(reason: ClassificationReason): string {
  const labels: Record<ClassificationReason, string> = {
    transactional_terms: "Detectamos señales de recibo, pedido, seguridad o entrega.",
    gmail_promotions: "Gmail colocó estos mensajes en su categoría Promociones.",
    promotional_terms: "Detectamos ofertas, descuentos u otras frases comerciales.",
    gmail_categories: "Gmail los identificó como actualizaciones, mensajes sociales o foros.",
    editorial_terms: "Detectamos señales editoriales como newsletter, boletín o resumen.",
    unsubscribe_header: "El remitente incluye un encabezado para cancelar la suscripción.",
    unsubscribe_content: "El contenido incluye una opción para cancelar la suscripción.",
    no_signals: "No encontramos señales suficientes; conviene revisar esta clasificación.",
    legacy_classification: "Conservamos la clasificación del análisis anterior; puedes corregirla si hace falta.",
  };
  return labels[reason];
}

export function messageTimestamp(value?: string): number {
  const timestamp = Number(value ?? 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function indexedMessageValues(accountEmail: string, message: GmailMessage) {
  const fromValue = gmailHeader(message, "From");
  if (!fromValue) return null;
  const sender = senderFrom(fromValue);
  const classification = classificationFor(message, fromValue);
  return {
    id: `${accountEmail}:${message.id}`,
    accountEmail,
    messageId: message.id,
    senderEmail: sender.email,
    senderName: sender.name,
    senderDomain: sender.email.split("@")[1] ?? sender.email,
    subject: gmailHeader(message, "Subject"),
    snippet: message.snippet ?? "",
    category: classification.category,
    classificationReason: classification.reason,
    classificationConfidence: classification.confidence,
    receivedAt: messageTimestamp(message.internalDate),
    hasUnsubscribe: Boolean(gmailHeader(message, "List-Unsubscribe")) || /unsubscribe|opt[\s-]?out|cancelar\s+(?:la\s+)?suscripci[oó]n|darse\s+de\s+baja|desuscrib|dejar\s+de\s+recibir|manage\s+(?:email\s+)?preferences|preferencias\s+(?:de\s+)?(?:correo|comunicaci[oó]n|suscripci[oó]n)/i.test(message.snippet ?? ""),
    indexedAt: Date.now(),
  };
}
