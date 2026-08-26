import { timingSafeEqual } from "node:crypto";
import { apiService } from "@/lib/api/runtime";
import {
  apiError,
  handleRouteError,
  jsonResponse,
  optionsResponse,
  resourceResponse,
} from "@/lib/api/http";
import {
  isUuid,
  normalizeMovieSlug,
  normalizeUsername,
  parseManualJobRequest,
  parseListQuery,
  parseOverlapRequest,
  parseTmdbMovieId,
  parseWatchedListQuery,
  parseWatchedOverlapRequest,
} from "@/lib/api/validation";

type ParamContext<TKey extends string> = {
  params: Promise<Record<TKey, string>>;
};

export async function getProfile(
  request: Request,
  { params }: ParamContext<"username">
): Promise<Response> {
  try {
    const username = normalizeUsername((await params).username);
    return resourceResponse(request, await apiService.getProfile(username));
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function getWatchlist(
  request: Request,
  { params }: ParamContext<"username">
): Promise<Response> {
  try {
    const username = normalizeUsername((await params).username);
    const query = parseListQuery(new URL(request.url).searchParams);
    return resourceResponse(
      request,
      await apiService.getWatchlist(username, query)
    );
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function getWatched(
  request: Request,
  { params }: ParamContext<"username">
): Promise<Response> {
  try {
    const username = normalizeUsername((await params).username);
    const query = parseWatchedListQuery(new URL(request.url).searchParams);
    return resourceResponse(
      request,
      await apiService.getWatched(username, query)
    );
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function getNetwork(
  request: Request,
  { params }: ParamContext<"username">
): Promise<Response> {
  try {
    const username = normalizeUsername((await params).username);
    return resourceResponse(request, await apiService.getNetwork(username));
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function getMovie(
  request: Request,
  { params }: ParamContext<"tmdbId">
): Promise<Response> {
  try {
    const tmdbId = parseTmdbMovieId((await params).tmdbId);
    return resourceResponse(request, await apiService.getMovie(tmdbId));
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function getMovieByLetterboxdSlug(
  request: Request,
  { params }: ParamContext<"letterboxdSlug">
): Promise<Response> {
  try {
    const slug = normalizeMovieSlug((await params).letterboxdSlug);
    return resourceResponse(
      request,
      await apiService.getMovieByLetterboxdSlug(slug)
    );
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function getOverlap(request: Request): Promise<Response> {
  try {
    const parsed = parseOverlapRequest(new URL(request.url).searchParams);
    return resourceResponse(
      request,
      await apiService.getOverlap(parsed.users, parsed.query)
    );
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function getWatchedOverlap(request: Request): Promise<Response> {
  try {
    const parsed = parseWatchedOverlapRequest(new URL(request.url).searchParams);
    return resourceResponse(
      request,
      await apiService.getWatchedOverlap(parsed.users, parsed.query)
    );
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function getJob(
  request: Request,
  { params }: ParamContext<"jobId">
): Promise<Response> {
  try {
    const jobId = (await params).jobId;
    if (!isUuid(jobId)) {
      return apiError(request, "job_not_found", "Job not found", 404);
    }
    const result = await apiService.getJob(jobId);
    if ("error" in result) {
      return apiError(request, result.error.code, result.error.message, 404);
    }
    return jsonResponse(request, result);
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export async function postJob(request: Request): Promise<Response> {
  if (!isAuthorizedManualJobRequest(request)) {
    return apiError(request, "unauthorized", "Unauthorized", 401);
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(request, "invalid_request", "A valid JSON body is required", 400);
    }
    const job = parseManualJobRequest(body);
    return resourceResponse(
      request,
      await apiService.requestJob(job.type, job.identifier)
    );
  } catch (error) {
    return handleRouteError(request, error);
  }
}

export function manualJobOptions(request: Request): Response {
  return optionsResponse(request, "POST, OPTIONS");
}

function isAuthorizedManualJobRequest(request: Request): boolean {
  const apiKey = process.env.MANUAL_JOB_API_KEY;
  if (!apiKey) return false;

  const actual = Buffer.from(request.headers.get("Authorization") ?? "");
  const expected = Buffer.from(`Bearer ${apiKey}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function OPTIONS(request: Request): Response {
  return optionsResponse(request);
}
