import {
  authorizedGoogleSession,
  googleApiError,
  jsonWithSession,
} from "@/lib/google";

type GmailHeader = { name: string; value: string };
type GmailMessage = {
  id: string;
  internalDate?: string;
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
  messageIds: string[];
  primaryMessageId: string;
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
  const value = `${from} ${precedence}`.toLowerCase();
  if (/sale|promo|offer|marketing|shop|store|deals|temu|aliexpress/.test(value)) {
    return "Publicidad";
  }
  if (unsubscribe || /bulk|list/.test(precedence)) return "Newsletters";
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
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", "100");
  listUrl.searchParams.set("q", "newer_than:90d");
  const listResponse = await fetch(listUrl, { headers: auth });
  if (!listResponse.ok) {
    return jsonWithSession(
      { error: await googleApiError(listResponse, "No se pudieron consultar los mensajes de Gmail") },
      502,
      setCookie,
    );
  }
  const list = (await listResponse.json()) as { messages?: Array<{ id: string }> };
  const ids = list.messages ?? [];
  const messages: GmailMessage[] = [];

  for (let index = 0; index < ids.length; index += 15) {
    const batch = ids.slice(index, index + 15);
    const results = await Promise.all(batch.map(async ({ id }) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      url.searchParams.set("format", "metadata");
      for (const name of [
        "From",
        "List-Unsubscribe",
        "List-Unsubscribe-Post",
        "Precedence",
      ]) url.searchParams.append("metadataHeaders", name);
      const response = await fetch(url, { headers: auth });
      return response.ok ? (await response.json()) as GmailMessage : null;
    }));
    messages.push(...results.filter((item): item is GmailMessage => Boolean(item)));
  }

  const grouped = new Map<string, SenderGroup>();
  for (const message of messages) {
    const fromValue = header(message, "From");
    if (!fromValue) continue;
    const sender = senderFrom(fromValue);
    const existing = grouped.get(sender.email);
    if (existing) {
      existing.count += 1;
      existing.messageIds.push(message.id);
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
      messageIds: [message.id],
      primaryMessageId: message.id,
    });
  }

  const groups = [...grouped.values()]
    .filter((group) => group.unsub || group.count >= 2)
    .sort((a, b) => b.count - a.count);
  return jsonWithSession(
    {
      email: session.email,
      groups,
      scanned: messages.length,
    },
    200,
    setCookie,
  );
}
