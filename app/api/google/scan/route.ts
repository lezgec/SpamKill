import {
  authorizedGoogleSession,
  buildMailboxQuery,
  googleApiError,
  jsonWithSession,
  type ScanRange,
} from "@/lib/google";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { unsubscribeHistory } from "@/db/schema";

type GmailHeader = { name: string; value: string };
type GmailMessage = {
  id: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
};

type SenderGroup = {
  id: string;
  name: string;
  domain: string;
  count: number;
  category: "Publicidad" | "Newsletters" | "Notificaciones";
  color: string;
  initials: string;
  last: string;
  unsub: boolean;
  primaryMessageId: string;
  latestAt: number;
};

const palette = ["#f2612f", "#7b61ff", "#1676b7", "#e74334", "#111827", "#ef9d24"];

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";
}

function senderFrom(value: string) {
  const match = value.match(/^(?:"?([^"<]+)"?\s*)?<([^>]+)>$/);
  const email = (match?.[2] ?? value).trim().toLowerCase();
  const name = (match?.[1] ?? email.split("@")[0] ?? email).trim();
  return { email, name };
}

function categoryFor(message: GmailMessage, from: string): SenderGroup["category"] {
  const unsubscribe = header(message, "List-Unsubscribe");
  const precedence = header(message, "Precedence").toLowerCase();
  const subject = header(message, "Subject");
  const value = `${from} ${subject} ${message.snippet ?? ""} ${precedence}`.toLowerCase();
  const labels = new Set(message.labelIds ?? []);
  const transactional = /recibo|factura|pedido|orden|compra confirmada|confirmaci[oó]n|contrase[nñ]a|c[oó]digo|verificaci[oó]n|seguridad|env[ií]o|entrega|receipt|invoice|order|password|verification|security|shipped|delivered/.test(value);
  const promotional = /oferta|descuento|promoci[oó]n|cup[oó]n|rebaja|ahorra|compra ahora|env[ií]o gratis|precio especial|solo hoy|última oportunidad|sale|discount|promo|coupon|save \d|shop now|free shipping|special price|limited time|deal|% off|temu|aliexpress/.test(value);
  const editorial = /newsletter|bolet[ií]n|resumen|semanal|diario|novedades|noticias|digest|weekly|daily|insights|roundup/.test(value);

  if (transactional && !promotional) return "Notificaciones";
  if (labels.has("CATEGORY_PROMOTIONS") || promotional) {
    return "Publicidad";
  }
  if (
    labels.has("CATEGORY_UPDATES") ||
    labels.has("CATEGORY_SOCIAL") ||
    labels.has("CATEGORY_FORUMS")
  ) return "Notificaciones";
  if (editorial || unsubscribe || /bulk|list/.test(precedence)) return "Newsletters";
  return "Notificaciones";
}

function formatDate(internalDate?: string): string {
  if (!internalDate) return "—";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(
    new Date(Number(internalDate)),
  );
}

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);

  const auth = { Authorization: `Bearer ${session.accessToken}` };
  const requestUrl = new URL(request.url);
  const rangeValue = requestUrl.searchParams.get("range") ?? "all";
  const range = (["all", "30d", "90d", "1y", "custom"].includes(rangeValue)
    ? rangeValue
    : "all") as ScanRange;
  let query: string;
  try {
    query = buildMailboxQuery({
      range,
      after: requestUrl.searchParams.get("after"),
      before: requestUrl.searchParams.get("before"),
    });
  } catch (error) {
    return jsonWithSession(
      { error: error instanceof Error ? error.message : "El intervalo no es válido." },
      400,
      setCookie,
    );
  }
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", "100");
  listUrl.searchParams.set("q", query);
  const pageToken = requestUrl.searchParams.get("pageToken");
  if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
  const listResponse = await fetch(listUrl, { headers: auth });
  if (!listResponse.ok) {
    if (listResponse.status === 429) {
      return jsonWithSession(
        {
          error: "Gmail alcanzó temporalmente su cuota por usuario.",
          retryAfter: 60,
        },
        429,
        setCookie,
      );
    }
    return jsonWithSession(
      { error: await googleApiError(listResponse, "No se pudieron consultar los mensajes de Gmail") },
      502,
      setCookie,
    );
  }
  const list = (await listResponse.json()) as {
    messages?: Array<{ id: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };
  const ids = list.messages ?? [];
  const messages: GmailMessage[] = [];

  for (let index = 0; index < ids.length; index += 15) {
    const batch = ids.slice(index, index + 15);
    const results = await Promise.all(batch.map(async ({ id }) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      url.searchParams.set("format", "metadata");
      for (const name of [
        "From",
        "Subject",
        "List-Unsubscribe",
        "List-Unsubscribe-Post",
        "Precedence",
      ]) url.searchParams.append("metadataHeaders", name);
      const response = await fetch(url, { headers: auth });
      return {
        message: response.ok ? (await response.json()) as GmailMessage : null,
        rateLimited: response.status === 429,
      };
    }));
    if (results.some((item) => item.rateLimited)) {
      return jsonWithSession(
        {
          error: "Gmail alcanzó temporalmente su cuota por usuario.",
          retryAfter: 60,
        },
        429,
        setCookie,
      );
    }
    messages.push(...results.map((item) => item.message).filter((item): item is GmailMessage => Boolean(item)));
  }

  const grouped = new Map<string, SenderGroup>();
  for (const message of messages) {
    const fromValue = header(message, "From");
    if (!fromValue) continue;
    const sender = senderFrom(fromValue);
    const existing = grouped.get(sender.email);
    if (existing) {
      existing.count += 1;
      const receivedAt = Number(message.internalDate ?? 0);
      if (receivedAt > existing.latestAt) {
        existing.latestAt = receivedAt;
        existing.last = formatDate(message.internalDate);
        existing.primaryMessageId = message.id;
      }
      continue;
    }
    const domain = sender.email.split("@")[1] ?? sender.email;
    const position = grouped.size;
    grouped.set(sender.email, {
      id: sender.email,
      name: sender.name,
      domain,
      count: 1,
      category: categoryFor(message, fromValue),
      color: palette[position % palette.length],
      initials: sender.name.slice(0, 2).toUpperCase(),
      last: formatDate(message.internalDate),
      unsub: Boolean(header(message, "List-Unsubscribe")),
      primaryMessageId: message.id,
      latestAt: Number(message.internalDate ?? 0),
    });
  }

  const groups = [...grouped.values()]
    .sort((a, b) => b.count - a.count);

  const db = getDb();
  const history = await db
    .select()
    .from(unsubscribeHistory)
    .where(eq(unsubscribeHistory.accountEmail, session.email));
  const now = Date.now();
  for (const record of history) {
    const current = grouped.get(record.senderEmail);
    let nextStatus = record.status;
    let lastSeenAt = record.lastSeenAt;
    if (current && current.latestAt > record.requestedAt + 5 * 60 * 1000) {
      nextStatus = "failed";
      lastSeenAt = current.latestAt;
    } else if (
      record.status === "verifying" &&
      now - record.requestedAt >= 7 * 24 * 60 * 60 * 1000
    ) {
      nextStatus = "confirmed";
    }
    if (nextStatus !== record.status || lastSeenAt !== record.lastSeenAt) {
      await db
        .update(unsubscribeHistory)
        .set({ status: nextStatus, lastSeenAt, updatedAt: now })
        .where(and(
          eq(unsubscribeHistory.accountEmail, session.email),
          eq(unsubscribeHistory.senderEmail, record.senderEmail),
        ));
    }
  }
  return jsonWithSession(
    {
      email: session.email,
      groups,
      scanned: messages.length,
      nextPageToken: list.nextPageToken ?? null,
      resultSizeEstimate: list.resultSizeEstimate ?? messages.length,
    },
    200,
    setCookie,
  );
}
