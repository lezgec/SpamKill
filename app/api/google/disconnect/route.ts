import { GOOGLE_SESSION_COOKIE, clearCookie } from "@/lib/google";

export async function POST(request: Request) {
  return new Response(JSON.stringify({ disconnected: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearCookie(request, GOOGLE_SESSION_COOKIE),
    },
  });
}
