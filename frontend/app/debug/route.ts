export async function GET() {
  const railway = process.env.RAILWAY_API_URL;
  const runpod = process.env.RUNPOD_ENDPOINT_URL;

  try {
    const health = railway
      ? await fetch(`${railway}/health`, { cache: "no-store" }).then(async (r) => ({
          status: r.status,
          text: await r.text(),
        }))
      : null;

    return Response.json({
      ok: true,
      hasRailwayUrl: !!railway,
      hasRunpodUrl: !!runpod,
      railwayHealth: health,
    });
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        hasRailwayUrl: !!railway,
        hasRunpodUrl: !!runpod,
        error: err?.message || "unknown error",
      },
      { status: 500 }
    );
  }
}
