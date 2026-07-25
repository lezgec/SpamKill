import {
  authorizedGoogleSession,
  buildMailboxQuery,
  googleApiError,
  jsonWithSession,
  type ScanRange,
} from "@/lib/google";

type GmailHeader = { name: string; value: string };
type GmailMessage = {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: GmailHeader[] };
};

function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  )?.value ?? "";
}

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);

  const requestUrl = new URL(request.url);
  const sender = requestUrl.searchParams.get("sender");
  if (!sender) return jsonWithSession({ error: "Falta el remitente." }, 400, setCookie);
  const rangeValue = requestUrl.searchParams.get("range") ?? "90d";
  const range = (["all", "30d", "90d", "1y", "custom"].includes(rangeValue)
    ? rangeValue
    : "90d") as ScanRange;
  let query: string;
  try {
    query = buildMailboxQuery({
      range,
      after: requestUrl.searchParams.get("after"),
      before: requestUrl.searchParams.get("before"),
      sender,
    });
  } catch (error) {
    return jsonWithSession(
      { error: error instanceof Error ? error.message : "La consulta no es válida." },
      400,
      setCookie,
    );
  }

  const auth = { Authorization: `Bearer ${session.accessToken}` };
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", "50");
  listUrl.searchParams.set("q", query);
  const pageToken = requestUrl.searchParams.get("pageToken");
  if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
  const listResponse = await fetch(listUrl, { headers: auth });
  if (!listResponse.ok) {
    if (listResponse.status === 429) {
      return jsonWithSession(
        { error: "Gmail solicita una pausa antes de cargar más mensajes.", retryAfter: 60 },
        429,
        setCookie,
      );
    }
    return jsonWithSession(
      { error: await googleApiError(listResponse, "No se pudieron listar los mensajes") },
      502,
      setCookie,
    );
  }
  const page = (await listResponse.json()) as {
    messages?: Array<{ id: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };

  const details: GmailMessage[] = [];
  const ids = page.messages ?? [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const results = await Promise.all(batch.map(async ({ id }) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      url.searchParams.set("format", "metadata");
      for (const name of ["From", "Subject", "List-Unsubscribe"]) {
        url.searchParams.append("metadataHeaders", name);
      }
      const response = await fetch(url, { headers: auth });
      return {
        message: response.ok ? (await response.json()) as GmailMessage : null,
        rateLimited: response.status === 429,
      };
    }));
    if (results.some((item) => item.rateLimited)) {
      return jsonWithSession(
        { error: "Gmail solicita una pausa antes de cargar más mensajes.", retryAfter: 60 },
        429,
        setCookie,
      );
    }
    details.push(...results.map((item) => item.message).filter((item): item is GmailMessage => Boolean(item)));
  }

  return jsonWithSession(
    {
      messages: details.map((message) => ({
        id: message.id,
        subject: header(message, "Subject") || "(Sin asunto)",
        snippet: message.snippet ?? "",
        from: header(message, "From"),
        receivedAt: Number(message.internalDate ?? 0),
        hasUnsubscribe: Boolean(header(message, "List-Unsubscribe")),
      })),
      nextPageToken: page.nextPageToken ?? null,
      resultSizeEstimate: page.resultSizeEstimate ?? details.length,
    },
    200,
    setCookie,
  );
}
