import { authorizedGoogleSession, jsonWithSession } from "@/lib/google";

export async function GET(request: Request) {
  try {
    const { session, setCookie } = await authorizedGoogleSession(request);
    return jsonWithSession(
      { connected: Boolean(session), email: session?.email ?? null },
      200,
      setCookie,
    );
  } catch {
    return Response.json({ connected: false, email: null });
  }
}
