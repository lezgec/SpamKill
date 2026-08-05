import {
  OUTLOOK_SESSION_COOKIE,
  OUTLOOK_STATE_COOKIE,
  createCookie,
  outlookConfig,
  outlookProfile,
  outlookTokenRequest,
} from "@/lib/outlook";
import { clearCookie, encryptSession, readCookie } from "@/lib/google";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const expectedState = readCookie(request, OUTLOOK_STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) {
    return Response.redirect(`${requestUrl.origin}/?outlook_error=invalid_state`, 302);
  }

  try {
    const { clientId, clientSecret, redirectUri } = outlookConfig(request);
    const tokenResponse = await outlookTokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: "openid profile email offline_access User.Read Mail.ReadWrite",
    });
    if (!tokenResponse.ok) {
      throw new Error(`Microsoft rechazó el intercambio OAuth (${tokenResponse.status}).`);
    }
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const session = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      email: "",
    };
    const profile = await outlookProfile(session);
    if (!profile) throw new Error("No se pudo obtener el perfil de Outlook.");
    session.email = profile.email;

    const headers = new Headers({
      Location: `${requestUrl.origin}/?provider=outlook&connected=1`,
    });
    headers.append(
      "Set-Cookie",
      createCookie(
        request,
        OUTLOOK_SESSION_COOKIE,
        await encryptSession(session),
        60 * 60 * 24 * 30,
      ),
    );
    headers.append("Set-Cookie", clearCookie(request, OUTLOOK_STATE_COOKIE));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    const url = new URL("/", requestUrl.origin);
    url.searchParams.set("outlook_error", message);
    return Response.redirect(url, 302);
  }
}
