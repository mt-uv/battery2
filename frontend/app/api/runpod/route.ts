export async function POST(req: Request) {
  const body = await req.json();

  const res = await fetch(process.env.RUNPOD_ENDPOINT!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return Response.json(data, { status: res.status });
}