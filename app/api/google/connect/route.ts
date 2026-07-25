import {
  GOOGLE_STATE_COOKIE,
  createCookie,
  googleConfig,
  randomState,
} from "@/lib/google";

export async function GET(request: Request) {
  try {
    const { clientId, redirectUri } = googleConfig(request);
    const state = randomState();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      scope: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.modify",
      ].join(" "),
    }).toString();

    return new Response(null, {
      status: 302,
      headers: {
        Location: url.toString(),
        "Set-Cookie": createCookie(request, GOOGLE_STATE_COOKIE, state, 600),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar Google OAuth.";
    return Response.json({ error: message }, { status: 500 });
  }
}
