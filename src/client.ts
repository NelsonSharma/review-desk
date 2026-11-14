import type { Attachment, Comment, Review, ReviewSummary, User } from "./model";

let csrf: string | null = null;

export type SiteState = {
  user: User | null;
  csrf: string | null;
  reviews: ReviewSummary[];
  adminReady: boolean;
};

export type OpenReview = { info: ReviewSummary; review: Review; revision: number };
export type ManagedUser = User & { disabled: boolean };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function setSession(token: string | null) { csrf = token; }

export async function api<T>(path: string, options: { method?: string; data?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers();
  const form = options.data instanceof FormData;
  if (method !== "GET") {
    headers.set("X-Review-Request", "1");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  if (options.data !== undefined && !form) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch("/api" + path, { method, headers, credentials: "same-origin", signal: options.signal,
      body: options.data === undefined ? undefined : form ? options.data as FormData : JSON.stringify(options.data) });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("The server could not be reached. Check your connection and try again.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(typeof body.error === "string" ? body.error : "The server could not complete this request.", response.status);
  return body as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "This action could not be completed.";
}
export type { Attachment, Comment };
