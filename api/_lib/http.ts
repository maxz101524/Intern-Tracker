export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

export function methodNotAllowed(allow: string): Response {
  return json(405, { error: 'Method not allowed.' }, { allow })
}

export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
