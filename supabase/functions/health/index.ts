// Minimal local runtime smoke endpoint.
Deno.serve((_req) => {
  const body = {
    ok: true,
    service: Deno.env.get("APP_NAME") ?? "BOGA-backend",
    environment: Deno.env.get("APP_ENV") ?? "local",
    apiSurface: "edge-function-health-smoke",
    note: "Local health endpoint only.",
    now: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});
