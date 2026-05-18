import type { ApiErrorPayload, QueryValue, RequestOptions } from "./types";

export const authUnauthorizedEvent = "online-ssh:auth-unauthorized";

export type AuthUnauthorizedReason = "session_revoked" | "session_invalid";

let authRefreshHandler: (() => Promise<unknown>) | null = null;
let authRefreshPromise: Promise<unknown> | null = null;

export function setAuthRefreshHandler(handler: (() => Promise<unknown>) | null) {
  authRefreshHandler = handler;
}

function buildQueryString(query?: Record<string, QueryValue>) {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, String(item)));
      return;
    }

    params.set(key, String(value));
  });

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export class HttpError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown> | null;
  payload?: unknown;

  constructor(status: number, payload?: Partial<ApiErrorPayload> | unknown) {
    const typedPayload =
      typeof payload === "object" && payload !== null ? (payload as Partial<ApiErrorPayload>) : undefined;
    super(typedPayload?.message || "request failed");
    this.name = "HttpError";
    this.status = status;
    this.code = typedPayload?.code || "HTTP_ERROR";
    this.details = typedPayload?.details;
    this.payload = payload;
  }
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

export function isAuthInvalidatedError(error: unknown): error is HttpError {
  return error instanceof HttpError &&
    error.status === 401 &&
    (error.code === "AUTH_SESSION_REVOKED" || error.code === "AUTH_SESSION_INVALIDATED");
}

function authUnauthorizedReasonFromCode(code?: string): AuthUnauthorizedReason {
  if (code === "AUTH_SESSION_REVOKED" || code === "AUTH_SESSION_INVALIDATED") {
    return "session_revoked";
  }
  return "session_invalid";
}

function shouldHandleAsAuthUnauthorized(code?: string) {
  return !code || code === "UNAUTHORIZED" || code === "AUTH_SESSION_REVOKED" || code === "AUTH_SESSION_INVALIDATED";
}

function dispatchAuthUnauthorized(reason: AuthUnauthorizedReason) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(authUnauthorizedEvent, { detail: { reason } }));
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return parseJsonBody(response);
  }

  if (contentType.startsWith("text/")) {
    return await response.text();
  }

  return undefined;
}

async function parseJsonBody(response: Response) {
  if (response.status === 204 || response.status === 205) {
    return undefined;
  }

  const text = await response.text();
  if (!text) {
    return undefined;
  }

  return JSON.parse(text) as unknown;
}

export async function request<T>(options: RequestOptions): Promise<T> {
  return executeRequest(options, true);
}

export type BlobRequestOptions = Omit<RequestOptions, "responseType">;

export function requestBlob(options: BlobRequestOptions): Promise<Blob> {
  return request<Blob>({
    ...options,
    responseType: "blob"
  });
}

async function executeRequest<T>(options: RequestOptions, allowAuthRefresh: boolean): Promise<T> {
  const {
    method = "GET",
    path,
    query,
    body,
    bodyType = "json",
    headers,
    signal,
    responseType = "json",
    skipAuthRefresh = false
  } = options;

  const response = await fetch(`${path}${buildQueryString(query)}`, {
    method,
    credentials: "include",
    signal,
    headers: {
      ...(body && bodyType === "json" ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body:
      body === undefined
        ? undefined
        : bodyType === "raw"
          ? (body as BodyInit)
          : JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = (await parseResponseBody(response)) as Partial<ApiErrorPayload> | null;
    if (
      response.status === 401 &&
      !skipAuthRefresh &&
      (payload?.code === "AUTH_SESSION_REVOKED" || payload?.code === "AUTH_SESSION_INVALIDATED")
    ) {
      dispatchAuthUnauthorized(authUnauthorizedReasonFromCode(payload.code));
      throw new HttpError(response.status, payload ?? undefined);
    }
    if (
      response.status === 401 &&
      allowAuthRefresh &&
      !skipAuthRefresh &&
      authRefreshHandler &&
      shouldHandleAsAuthUnauthorized(payload?.code)
    ) {
      try {
        if (!authRefreshPromise) {
          authRefreshPromise = authRefreshHandler();
        }
        await authRefreshPromise;
        return executeRequest(options, false);
      } catch {
        dispatchAuthUnauthorized(authUnauthorizedReasonFromCode(payload?.code));
      } finally {
        authRefreshPromise = null;
      }
    } else if (response.status === 401 && !skipAuthRefresh && shouldHandleAsAuthUnauthorized(payload?.code)) {
      dispatchAuthUnauthorized(authUnauthorizedReasonFromCode(payload?.code));
    }
    throw new HttpError(response.status, payload ?? undefined);
  }

  if (responseType === "void") {
    return undefined as T;
  }

  if (responseType === "blob") {
    return (await response.blob()) as T;
  }

  if (responseType === "text") {
    return (await response.text()) as T;
  }

  return (await parseJsonBody(response)) as T;
}
