export type GoogleSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  email: string;
};

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
