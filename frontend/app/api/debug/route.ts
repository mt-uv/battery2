// app/api/debug/route.ts
export async function GET() {
  return Response.json({ ok: true, route: "debug" });
}
