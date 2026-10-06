/** Shared request guards for route handlers. */
export const DRAFT_ID = /^run_[a-z0-9_]+_d1$/;
export const DISPUTE_ID = /^PP-[A-Z0-9-]{3,40}$/;

/** Mutating calls must carry this header: a cross-site form or image can't set it, so it blocks CSRF. */
export const ACTION_HEADER = "x-dd-action";
export const isAppAction = (req: Request) => req.headers.get(ACTION_HEADER) === "1";

export async function jsonBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
