import { clearOutlookSession } from "@/lib/outlook";

export async function POST(request: Request) {
  return new Response(JSON.stringify({ disconnected: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearOutlookSession(request),
    },
  });
}
