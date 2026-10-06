/** Records requests and replays canned responses; any unexpected request fails the test. */
export interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
}

type Responder = (req: Recorded) => { status?: number; json?: unknown; headers?: Record<string, string> };

export function fakeFetch(routes: Record<string, Responder>) {
  const calls: Recorded[] = [];
  const fn = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const req: Recorded = { url, method, headers, body: init.body };
    calls.push(req);
    const key = Object.keys(routes).find((k) => `${method} ${url}`.includes(k));
    if (!key) throw new Error(`Unexpected request: ${method} ${url}`);
    const r = routes[key](req);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), {
      status: r.status ?? 200,
      headers: { "paypal-debug-id": "dbg123", ...r.headers },
    });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

export const TOKEN_ROUTE = {
  "POST https://api-m.sandbox.paypal.com/v1/oauth2/token": () => ({
    json: { access_token: "A21AA-fake-access-token-xyz", expires_in: 32400, scope: "https://uri.paypal.com/services/disputes/read-seller" },
  }),
};
