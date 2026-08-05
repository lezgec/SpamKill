import { authorizedOutlookSession, jsonWithSession, outlookConfig } from "@/lib/outlook";

export async function GET(request: Request) {
  try {
    try {
      outlookConfig(request);
    } catch {
      return jsonWithSession({ connected: false, configured: false, email: null }, 200);
    }
    const { session, setCookie } = await authorizedOutlookSession(request);
    return jsonWithSession(
      { connected: Boolean(session), configured: true, email: session?.email ?? null },
      200,
      setCookie,
    );
  } catch {
    return Response.json({ connected: false, email: null });
  }
}
