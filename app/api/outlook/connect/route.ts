import {
  OUTLOOK_STATE_COOKIE,
  createCookie,
  outlookAuthorizeUrl,
  outlookConfig,
  randomState,
} from "@/lib/outlook";

export async function GET(request: Request) {
  try {
    const { clientId, redirectUri } = outlookConfig(request);
    const state = randomState();
    return new Response(null, {
      status: 302,
      headers: {
        Location: outlookAuthorizeUrl({ clientId, redirectUri, state }),
        "Set-Cookie": createCookie(request, OUTLOOK_STATE_COOKIE, state, 600),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar Microsoft OAuth.";
    return Response.json({ error: message }, { status: 500 });
  }
}
