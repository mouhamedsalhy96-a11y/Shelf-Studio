import "server-only";
import { createClient } from "@supabase/supabase-js";

export class PublicError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new PublicError(503, "Generation is temporarily unavailable.");
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
}
export async function authenticated(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 8192)
    throw new PublicError(401, "Sign in to use AI generation.");
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(authorization.slice(7));
  if (error || !data.user || !data.user.email_confirmed_at)
    throw new PublicError(401, "Please sign in with a confirmed account.");
  return { admin, userId: data.user.id };
}
export const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function readBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new PublicError(403, "This request must come from your studio.");
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new PublicError(415, "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new PublicError(400, "The request is empty.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12000) {
        await reader.cancel();
        throw new PublicError(413, "The request is too large.");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid body");
    return body;
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(400, "The request could not be read.");
  } finally {
    reader.releaseLock();
  }
}
export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function failure(error: unknown) {
  return json(
    {
      error:
        error instanceof PublicError
          ? error.message
          : "The studio could not complete this request. Please try checking its status again.",
    },
    error instanceof PublicError ? error.status : 503,
  );
}
