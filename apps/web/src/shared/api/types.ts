export type ApiErrorPayload = {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

export type RequestOptions = {
  method?: HttpMethod;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  bodyType?: "json" | "raw";
  headers?: HeadersInit;
  signal?: AbortSignal;
  responseType?: "json" | "blob" | "text" | "void";
  skipAuthRefresh?: boolean;
};
