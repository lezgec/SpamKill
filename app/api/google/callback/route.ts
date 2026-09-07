import {
  GOOGLE_SESSION_COOKIE,
  GOOGLE_STATE_COOKIE,
  clearCookie,
  createCookie,
  encryptSession,
  googleApiError,
  googleConfig,
  getBaseUrl,
  readCookie,
  type GoogleSession,
} from "@/lib/google";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const baseUrl = getBaseUrl(request);
  const expectedState = readCookie(request, GOOGLE_STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    return Response.redirect(`${baseUrl}/?google_error=invalid_state`, 302);
  }

  try {
    const { clientId, clientSecret, redirectUri } = googleConfig(request);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Google rechazó el intercambio OAuth (${tokenResponse.status}).`);
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const profileResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!profileResponse.ok) {
      throw new Error(await googleApiError(profileResponse, "No se pudo obtener el correo de Google"));
    }
    const profile = (await profileResponse.json()) as { email: string };

    const session: GoogleSession = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      email: profile.email,
    };

    const headers = new Headers({
      Location: `${baseUrl}/?provider=gmail&connected=1`,
    });
    headers.append(
      "Set-Cookie",
      createCookie(
        request,
        GOOGLE_SESSION_COOKIE,
        await encryptSession(session),
        60 * 60 * 24 * 30,
      ),
    );
    headers.append("Set-Cookie", clearCookie(request, GOOGLE_STATE_COOKIE));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    const url = new URL("/", baseUrl);
    url.searchParams.set("google_error", message);
    return Response.redirect(url, 302);
  }
}
