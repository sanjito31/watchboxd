import type {
  ApiErrorCode,
  ApiErrorResponse,
  ApiResourceResponse,
} from "@/lib/api/contracts";
import { ApiValidationError } from "@/lib/api/validation";

const RETRY_AFTER_SECONDS = 2;

export function jsonResponse<T>(
  request: Request,
  body: T,
  init: ResponseInit = {}
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  applyCorsHeaders(request, headers);
  return Response.json(body, { ...init, headers });
}

export function resourceResponse<T>(
  request: Request,
  body: ApiResourceResponse<T>
): Response {
  if ("error" in body) {
    const status =
      body.error.code === "resource_not_found"
        ? 404
        : body.error.code === "rate_limited"
          ? 429
          : body.error.code === "upstream_unavailable"
            ? 503
            : body.error.code === "internal_error"
              ? 500
            : 400;
    return jsonResponse(request, body, { status });
  }

  if (body.meta.cache === "miss") {
    const firstJob = body.meta.jobs[0];
    return jsonResponse(request, body, {
      status: 202,
      headers: {
        Location: firstJob?.statusUrl ?? "/api/v1/jobs",
        "Retry-After": String(RETRY_AFTER_SECONDS),
      },
    });
  }

  return jsonResponse(request, body);
}

export function apiError(
  request: Request,
  code: ApiErrorCode,
  message: string,
  status: number
): Response {
  const body: ApiErrorResponse = { error: { code, message } };
  return jsonResponse(request, body, { status });
}

export function handleRouteError(request: Request, error: unknown): Response {
  if (error instanceof ApiValidationError) {
    return apiError(request, error.code, error.message, 400);
  }

  console.error("API request failed", {
    name: error instanceof Error ? error.name : "UnknownError",
  });
  return apiError(
    request,
    "internal_error",
    "The request could not be completed",
    500
  );
}

export function optionsResponse(request: Request): Response {
  const headers = new Headers({
    Allow: "GET, OPTIONS",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  applyCorsHeaders(request, headers);
  return new Response(null, { status: 204, headers });
}

function applyCorsHeaders(request: Request, headers: Headers): void {
  appendVary(headers, "Origin");
  const origin = request.headers.get("Origin");
  if (!origin) return;

  const allowedOrigins = parseAllowedOrigins(process.env.API_ALLOWED_ORIGINS);
  if (allowedOrigins.has("*")) {
    headers.set("Access-Control-Allow-Origin", "*");
  } else if (allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }

  const values = current.split(",").map((entry) => entry.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}
