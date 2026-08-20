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
  parseOverlapRequest,
  parsePagination,
  parseTmdbMovieId,
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
    const pagination = parsePagination(new URL(request.url).searchParams);
    return resourceResponse(
      request,
      await apiService.getWatchlist(
        username,
        pagination.page,
        pagination.pageSize
      )
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
    const pagination = parsePagination(new URL(request.url).searchParams);
    return resourceResponse(
      request,
      await apiService.getWatched(
        username,
        pagination.page,
        pagination.pageSize
      )
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
      await apiService.getOverlap(
        parsed.users,
        parsed.pagination.page,
        parsed.pagination.pageSize
      )
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

export const OPTIONS = optionsResponse;
