import {
  clearCookie,
  createCookie,
  decryptSession,
  encryptSession,
  jsonWithSession,
  randomState,
  readCookie,
  type GoogleSession,
} from "@/lib/google";

export const OUTLOOK_STATE_COOKIE = "spamkill_outlook_state";
export const OUTLOOK_SESSION_COOKIE = "spamkill_outlook";
export const OUTLOOK_ACCOUNT_PREFIX = "outlook:";

export type OutlookSession = GoogleSession;

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const IDENTITY_ROOT = "https://login.microsoftonline.com/common/oauth2/v2.0";
export const OUTLOOK_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
];

export function outlookAccountKey(email: string): string {
  return `${OUTLOOK_ACCOUNT_PREFIX}${email.toLowerCase()}`;
}

export function outlookConfig(request: Request) {
  const clientId = process.env.OUTLOOK_CLIENT_ID?.trim();
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Las credenciales OAuth de Outlook no están configuradas.");
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${new URL(request.url).origin}/api/outlook/callback`,
  };
}

export function outlookAuthorizeUrl({ clientId, redirectUri, state }: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`${IDENTITY_ROOT}/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: OUTLOOK_SCOPES.join(" "),
    state,
  }).toString();
  return url.toString();
}

export async function outlookTokenRequest(params: Record<string, string>) {
  return fetch(`${IDENTITY_ROOT}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
}

export async function outlookApiError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as {
      error?: { message?: string; code?: string };
      error_description?: string;
    };
    return payload.error?.message ?? payload.error_description ?? `${fallback} (${response.status}).`;
  } catch {
    return `${fallback} (${response.status}).`;
  }
}

export async function authorizedOutlookSession(
  request: Request,
): Promise<{ session: OutlookSession | null; setCookie?: string }> {
  const cookie = readCookie(request, OUTLOOK_SESSION_COOKIE);
  if (!cookie) return { session: null };
  const session = await decryptSession(cookie) as OutlookSession | null;
  if (!session) return { session: null };
  if (session.expiresAt > Date.now() + 60_000) return { session };
  if (!session.refreshToken) return { session: null };

  let config;
  try {
    config = outlookConfig(request);
  } catch {
    return { session: null };
  }
  const response = await outlookTokenRequest({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: session.refreshToken,
    grant_type: "refresh_token",
    scope: OUTLOOK_SCOPES.join(" "),
  });
  if (!response.ok) return { session: null };
  const tokens = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const refreshed: OutlookSession = {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
  return {
    session: refreshed,
    setCookie: createCookie(
      request,
      OUTLOOK_SESSION_COOKIE,
      await encryptSession(refreshed),
      60 * 60 * 24 * 30,
    ),
  };
}

export function outlookGraphUrl(pathOrUrl: string): string {
  return pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH_ROOT}${pathOrUrl}`;
}

export async function outlookGraphFetch(
  session: OutlookSession,
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  headers.set("Accept", "application/json");
  return fetch(outlookGraphUrl(pathOrUrl), { ...init, headers });
}

export async function outlookProfile(session: OutlookSession) {
  const response = await outlookGraphFetch(
    session,
    "/me?$select=mail,userPrincipalName,displayName",
  );
  if (!response.ok) return null;
  const profile = (await response.json()) as {
    mail?: string;
    userPrincipalName?: string;
    displayName?: string;
  };
  const email = (profile.mail ?? profile.userPrincipalName ?? "").trim().toLowerCase();
  return email ? { email, displayName: profile.displayName ?? email } : null;
}

export function clearOutlookSession(request: Request): string {
  return clearCookie(request, OUTLOOK_SESSION_COOKIE);
}

export { createCookie, jsonWithSession, randomState };
