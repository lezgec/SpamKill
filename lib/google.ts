export type GoogleSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  email: string;
};
export type ScanRange = "all" | "30d" | "90d" | "1y" | "custom";

export const GOOGLE_SESSION_COOKIE = "spamkill_google";
export const GOOGLE_STATE_COOKIE = "spamkill_google_state";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function secretMaterial(): string {
  const value =
    process.env.APP_ENCRYPTION_KEY?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!value) throw new Error("Falta APP_ENCRYPTION_KEY o GOOGLE_CLIENT_SECRET.");
  return value;
}

async function encryptionKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secretMaterial()));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSession(session: GoogleSession): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    encoder.encode(JSON.stringify(session)),
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptSession(value: string): Promise<GoogleSession | null> {
  try {
    const [ivValue, encryptedValue] = value.split(".");
    if (!ivValue || !encryptedValue) return null;
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesBuffer(base64UrlToBytes(ivValue)) },
      await encryptionKey(),
      bytesBuffer(base64UrlToBytes(encryptedValue)),
    );
    return JSON.parse(decoder.decode(decrypted)) as GoogleSession;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function createCookie(
  request: Request,
  name: string,
  value: string,
  maxAge: number,
): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(request: Request, name: string): string {
  return createCookie(request, name, "", 0);
}

export function googleConfig(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Las credenciales OAuth de Google no están configuradas.");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${new URL(request.url).origin}/api/google/callback`,
  };
}

export async function authorizedGoogleSession(
  request: Request,
): Promise<{ session: GoogleSession | null; setCookie?: string }> {
  const cookie = readCookie(request, GOOGLE_SESSION_COOKIE);
  if (!cookie) return { session: null };
  const session = await decryptSession(cookie);
  if (!session) return { session: null };
  if (session.expiresAt > Date.now() + 60_000) return { session };
  if (!session.refreshToken) return { session: null };

  const { clientId, clientSecret } = googleConfig(request);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: session.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) return { session: null };
  const tokens = (await response.json()) as { access_token: string; expires_in?: number };
  const refreshed: GoogleSession = {
    ...session,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
  return {
    session: refreshed,
    setCookie: createCookie(
      request,
      GOOGLE_SESSION_COOKIE,
      await encryptSession(refreshed),
      60 * 60 * 24 * 30,
    ),
  };
}

export function jsonWithSession(
  payload: unknown,
  status: number,
  setCookie?: string,
): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return new Response(JSON.stringify(payload), { status, headers });
}

export async function googleApiError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string };
      error_description?: string;
    };
    return payload.error?.message ?? payload.error_description ?? `${fallback} (${response.status}).`;
  } catch {
    return `${fallback} (${response.status}).`;
  }
}

export function randomState(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export function safeUnsubscribeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host === "0.0.0.0" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return null;
    return url;
  } catch {
    return null;
  }
}

export function extractHttpsUnsubscribe(header: string): URL | null {
  const matches = header.match(/<([^>]+)>/g) ?? [];
  for (const match of matches) {
    const url = safeUnsubscribeUrl(match.slice(1, -1));
    if (url) return url;
  }
  return null;
}

function safeMailtoUnsubscribe(value: string): string | null {
  if (value.length > 2_000 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "mailto:") return null;
    const recipient = decodeURIComponent(url.pathname).trim();
    if (
      recipient.length > 254 ||
      !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(recipient)
    ) return null;

    const target = new URL(`mailto:${url.pathname}`);
    for (const field of ["subject", "body"] as const) {
      const content = url.searchParams.get(field);
      if (content && content.length <= 1_000) target.searchParams.set(field, content);
    }
    return target.toString();
  } catch {
    return null;
  }
}

export function safeManualUnsubscribeTarget(value: string): string | null {
  const https = safeUnsubscribeUrl(value);
  return https?.toString() ?? safeMailtoUnsubscribe(value);
}

export function extractManualUnsubscribeTarget(header: string): string | null {
  const https = extractHttpsUnsubscribe(header);
  if (https) return https.toString();

  const matches = header.match(/<([^>]+)>/g) ?? [];
  for (const match of matches) {
    const mailto = safeMailtoUnsubscribe(match.slice(1, -1));
    if (mailto) return mailto;
  }
  return null;
}

export type GmailMimePart = {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailMimePart[];
};

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,
    (entity, code: string) => {
      const normalized = code.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      const numeric = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(numeric) && numeric > 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : entity;
    },
  );
}

function decodeGmailBody(data: string): string {
  if (!data || data.length > 1_500_000) return "";
  try {
    const normalized = data.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return decoder.decode(bytes);
  } catch {
    return "";
  }
}

function unsubscribeScore(label: string, href: string, context = ""): number {
  const explicit = /unsubscribe|opt[\s-]?out|cancelar\s+(?:la\s+)?suscripci[oó]n|darse\s+de\s+baja|desuscrib|dejar\s+de\s+recibir|no\s+recibir\s+m[aá]s/i;
  const preferences = /manage\s+(?:email\s+)?preferences|subscription\s+preferences|preferencias\s+(?:de\s+)?(?:correo|comunicaci[oó]n|suscripci[oó]n)|gestionar\s+(?:mis\s+)?preferencias/i;
  let score = 0;
  if (explicit.test(label)) score += 12;
  if (explicit.test(href)) score += 8;
  if (explicit.test(context)) score += 5;
  if (preferences.test(label)) score += 6;
  if (preferences.test(href)) score += 4;
  if (preferences.test(context)) score += 3;
  if (href.toLowerCase().startsWith("https:")) score += 1;
  return score;
}

function bestUnsubscribeTarget(content: string, html: boolean): string | null {
  type Candidate = { url: string; score: number };
  const candidates: Candidate[] = [];
  const addCandidate = (rawHref: string, label: string, context = "") => {
    const href = decodeHtmlEntities(rawHref.trim());
    const url = safeManualUnsubscribeTarget(href);
    if (!url) return;
    const score = unsubscribeScore(label, href, context);
    if (score >= 5) candidates.push({ url, score });
  };

  if (html) {
    const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
    for (const match of content.matchAll(anchorPattern)) {
      const attributes = match[1] ?? "";
      const hrefMatch = attributes.match(
        /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i,
      );
      const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3];
      if (!href) continue;
      const accessibleLabel = attributes.match(
        /\b(?:aria-label|title)\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
      );
      const label = decodeHtmlEntities(
        `${match[2].replace(/<[^>]*>/g, " ")} ${accessibleLabel?.[1] ?? accessibleLabel?.[2] ?? ""}`,
      );
      addCandidate(href, label);
    }
  }

  const visibleText = decodeHtmlEntities(html ? content.replace(/<[^>]*>/g, " ") : content);
  const urlPattern = /(?:https:\/\/[^\s<>"']+|mailto:[^\s<>"']+)/gi;
  for (const match of content.matchAll(urlPattern)) {
    const rawHref = match[0].replace(/[),.;]+$/, "");
    const start = Math.max(0, match.index - 140);
    const end = Math.min(content.length, match.index + match[0].length + 140);
    addCandidate(rawHref, "", decodeHtmlEntities(content.slice(start, end).replace(/<[^>]*>/g, " ")));
  }

  if (!candidates.length && !html) {
    for (const line of visibleText.split(/\r?\n/)) {
      if (unsubscribeScore(line, "") >= 5) {
        const address = line.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
        if (address) addCandidate(`mailto:${address}`, line);
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.url ?? null;
}

export function extractContentUnsubscribeTarget(payload?: GmailMimePart): string | null {
  if (!payload) return null;
  const parts: GmailMimePart[] = [payload];
  const htmlBodies: string[] = [];
  const textBodies: string[] = [];
  let totalLength = 0;

  while (parts.length && totalLength < 1_500_000) {
    const part = parts.shift();
    if (!part) continue;
    parts.push(...(part.parts ?? []));
    if (part.mimeType !== "text/html" && part.mimeType !== "text/plain") continue;
    const content = decodeGmailBody(part.body?.data ?? "");
    if (!content) continue;
    totalLength += content.length;
    (part.mimeType === "text/html" ? htmlBodies : textBodies).push(content);
  }

  for (const body of htmlBodies) {
    const target = bestUnsubscribeTarget(body, true);
    if (target) return target;
  }
  for (const body of textBodies) {
    const target = bestUnsubscribeTarget(body, false);
    if (target) return target;
  }
  return null;
}

function validDate(value?: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function buildMailboxQuery({
  range,
  after,
  before,
  sender,
}: {
  range: ScanRange;
  after?: string | null;
  before?: string | null;
  sender?: string | null;
}): string {
  const terms = ["-in:sent", "-in:drafts", "-in:spam", "-in:trash"];
  if (range === "30d") terms.push("newer_than:30d");
  if (range === "90d") terms.push("newer_than:90d");
  if (range === "1y") terms.push("newer_than:1y");
  if (range === "custom") {
    if (!validDate(after) || !validDate(before) || after > before) {
      throw new Error("Selecciona un intervalo de fechas válido.");
    }
    terms.push(`after:${after.replaceAll("-", "/")}`);
    const inclusiveEnd = new Date(`${before}T00:00:00Z`);
    inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() + 1);
    terms.push(`before:${inclusiveEnd.toISOString().slice(0, 10).replaceAll("-", "/")}`);
  }
  if (sender) {
    if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)) {
      throw new Error("El remitente seleccionado no es válido.");
    }
    terms.push(`from:(${sender})`);
  }
  return terms.join(" ");
}

export function rangeStartTimestamp(range: ScanRange, after?: string | null): number {
  const now = Date.now();
  if (range === "all") return 0;
  if (range === "30d") return now - 30 * 24 * 60 * 60 * 1000;
  if (range === "90d") return now - 90 * 24 * 60 * 60 * 1000;
  if (range === "1y") return now - 365 * 24 * 60 * 60 * 1000;
  if (range === "custom" && validDate(after)) return new Date(`${after}T00:00:00Z`).getTime();
  return now;
}
