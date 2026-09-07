import {
  classificationReasonText,
  classificationFor,
  gmailHeader,
  senderFrom,
  type GmailMessage,
} from "@/lib/gmail-index";
import { replaceIndexedMessages } from "@/lib/gmail-index-store";
import {
  authorizedOutlookSession,
  outlookAccountKey,
  outlookApiError,
  outlookGraphFetch,
  type OutlookSession,
} from "@/lib/outlook";
import { jsonWithSession, rangeStartTimestamp, type ScanRange } from "@/lib/google";

type GraphMessage = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  inferenceClassification?: string;
  parentFolderId?: string;
  isDraft?: boolean;
};
type SenderGroup = {
  id: string;
  name: string;
  domain: string;
  count: number;
  category: "Publicidad" | "Newsletters" | "Notificaciones";
  detectedCategory: "Publicidad" | "Newsletters" | "Notificaciones";
  detectedReason: string;
  classificationReason: string;
  confidence: "high" | "medium" | "low";
  doubtful: boolean;
  corrected: boolean;
  safe: boolean;
  color: string;
  initials: string;
  last: string;
  unsub: boolean;
  primaryMessageId: string;
  latestAt: number;
  folder: string;
};

const palette = ["#f2612f", "#7b61ff", "#1676b7", "#e74334", "#111827", "#ef9d24"];

function outlookTimestamp(value?: string): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

type OutlookFolderIds = { inbox: string; spam: string; trash: string };

async function outlookFolderIds(session: OutlookSession): Promise<OutlookFolderIds> {
  const names = ["inbox", "junkemail", "deleteditems"] as const;
  const values = await Promise.all(names.map(async (name) => {
    const response = await outlookGraphFetch(session, `/me/mailFolders/${name}?$select=id`);
    if (!response.ok) return "";
    try {
      const value = await response.json() as { id?: string };
      return value.id ?? "";
    } catch {
      return "";
    }
  }));
  return { inbox: values[0], spam: values[1], trash: values[2] };
}

function outlookMessageToGmail(message: GraphMessage, ids?: OutlookFolderIds): GmailMessage {
  const fromAddress = message.from?.emailAddress?.address ?? "";
  const fromName = message.from?.emailAddress?.name ?? fromAddress;
  const headers = [...(message.internetMessageHeaders ?? [])];
  if (!headers.some((item) => item.name.toLowerCase() === "from")) {
    headers.push({ name: "From", value: `${fromName} <${fromAddress}>` });
  }
  if (!headers.some((item) => item.name.toLowerCase() === "subject")) {
    headers.push({ name: "Subject", value: message.subject ?? "" });
  }
  return {
    id: message.id,
    internalDate: String(outlookTimestamp(message.receivedDateTime)),
    snippet: message.bodyPreview ?? "",
    payload: { headers },
    labelIds: [
      ...(message.inferenceClassification === "other" ? ["CATEGORY_PROMOTIONS"] : []),
      ...(outlookFolder(message, ids) === "Spam" ? ["SPAM"] : []),
      ...(outlookFolder(message, ids) === "Papelera" ? ["TRASH"] : []),
      ...(outlookFolder(message, ids) === "Bandeja de entrada" ? ["INBOX"] : []),
    ],
  };
}

function formatDate(value?: string): string {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "—";
  if (!value) return "—";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(value));
}

function outlookFilter(range: ScanRange, after?: string | null, before?: string | null): string {
  const start = rangeStartTimestamp(range, after);
  if (range === "all") return "isDraft eq false";
  const clauses = [`receivedDateTime ge ${new Date(start).toISOString()}`, "isDraft eq false"];
  if (range === "custom" && before) {
    const exclusiveEnd = new Date(`${before}T00:00:00Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    clauses.push(`receivedDateTime lt ${exclusiveEnd.toISOString()}`);
  }
  return clauses.join(" and ");
}

function outlookFolder(message: GraphMessage, ids?: OutlookFolderIds): string {
  const folder = (message.parentFolderId ?? "").toLowerCase();
  if (ids?.spam && message.parentFolderId === ids.spam) return "Spam";
  if (ids?.trash && message.parentFolderId === ids.trash) return "Papelera";
  if (ids?.inbox && message.parentFolderId === ids.inbox) return "Bandeja de entrada";
  if (folder.includes("junk") || folder.includes("spam")) return "Spam";
  if (folder.includes("trash") || folder.includes("deleted")) return "Papelera";
  if (folder.includes("inbox")) return "Bandeja de entrada";
  return "Archivado";
}

async function listMessages(
  session: OutlookSession,
  nextLink: string | null,
  range: ScanRange,
  after?: string | null,
  before?: string | null,
) {
  const url = nextLink ?? (() => {
    const query = new URLSearchParams({
      "$top": "50",
      "$select": "id,subject,bodyPreview,receivedDateTime,from,internetMessageHeaders,inferenceClassification,parentFolderId,isDraft",
      "$orderby": "receivedDateTime desc",
      "$filter": outlookFilter(range, after, before),
    });
    return `/me/messages?${query.toString()}`;
  })();
  if (nextLink && !nextLink.startsWith("https://graph.microsoft.com/")) return null;
  const response = await outlookGraphFetch(session, url);
  if (!response.ok) throw new Error(await outlookApiError(response, "No se pudieron consultar los mensajes de Outlook"));
  return (await response.json()) as {
    value?: GraphMessage[];
    "@odata.nextLink"?: string;
  };
}

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedOutlookSession(request);
  if (!session) return jsonWithSession({ error: "Outlook no está conectado." }, 401);
  const requestUrl = new URL(request.url);
  const rangeValue = requestUrl.searchParams.get("range") ?? "90d";
  const range = (["all", "30d", "90d", "1y", "custom"].includes(rangeValue) ? rangeValue : "90d") as ScanRange;
  const nextLink = requestUrl.searchParams.get("pageToken");
  try {
    const folderIds = await outlookFolderIds(session);
    const page = await listMessages(
      session,
      nextLink,
      range,
      requestUrl.searchParams.get("after"),
      requestUrl.searchParams.get("before"),
    );
    if (!page) return jsonWithSession({ error: "La página de Outlook no es válida." }, 400, setCookie);
    const messages = (page.value ?? []).filter((message) => !message.isDraft);
    const normalized = messages.map((message) => outlookMessageToGmail(message, folderIds));
    await replaceIndexedMessages(outlookAccountKey(session.email), normalized);

    const grouped = new Map<string, SenderGroup>();
    for (const message of normalized) {
      const fromValue = gmailHeader(message, "From");
      if (!fromValue) continue;
      const sender = senderFrom(fromValue);
      const classification = classificationFor(message, fromValue);
      const existing = grouped.get(sender.email);
      const receivedAt = Number(message.internalDate ?? 0);
      if (existing) {
        existing.count += 1;
        existing.unsub ||= Boolean(gmailHeader(message, "List-Unsubscribe")) || classification.reason === "unsubscribe_content";
        if (receivedAt > existing.latestAt) {
          existing.latestAt = receivedAt;
          existing.last = formatDate(message.internalDate);
          existing.primaryMessageId = message.id;
          existing.folder = outlookFolder(message, folderIds);
          existing.category = classification.category;
          existing.detectedCategory = classification.category;
          existing.detectedReason = classificationReasonText(classification.reason);
          existing.classificationReason = classificationReasonText(classification.reason);
          existing.confidence = classification.confidence;
          existing.doubtful = classification.confidence === "low";
        }
        continue;
      }
      const domain = sender.email.split("@")[1] ?? sender.email;
      const classificationReason = classificationReasonText(classification.reason);
      grouped.set(sender.email, {
        id: sender.email,
        name: sender.name,
        domain,
        count: 1,
        category: classification.category,
        detectedCategory: classification.category,
        detectedReason: classificationReason,
        classificationReason,
        confidence: classification.confidence,
        doubtful: classification.confidence === "low",
        corrected: false,
        safe: false,
        color: palette[grouped.size % palette.length],
        initials: sender.name.slice(0, 2).toUpperCase(),
        last: formatDate(message.internalDate),
        unsub: Boolean(gmailHeader(message, "List-Unsubscribe")) || classification.reason === "unsubscribe_content",
        primaryMessageId: message.id,
        latestAt: receivedAt,
        folder: outlookFolder(message, folderIds),
      });
    }

    return jsonWithSession({
      email: session.email,
      groups: [...grouped.values()].sort((left, right) => right.count - left.count),
      scanned: normalized.length,
      nextPageToken: page["@odata.nextLink"] ?? null,
      resultSizeEstimate: normalized.length + (page["@odata.nextLink"] ? 50 : 0),
    }, 200, setCookie);
  } catch (error) {
    return jsonWithSession({ error: error instanceof Error ? error.message : "No se pudo analizar Outlook." }, 502, setCookie);
  }
}
