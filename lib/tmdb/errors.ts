import {
  ProviderNotFoundError,
  ProviderPermanentError,
  type ProviderErrorOptions,
} from "@/lib/letterboxd/providerErrors";

export class TmdbNotFoundError extends ProviderNotFoundError {
  constructor(resource: string, options: ProviderErrorOptions = {}) {
    super(`TMDB resource not found: ${resource}`, {
      status: 404,
      ...options,
    });
    this.name = "TmdbNotFoundError";
  }
}

export class TmdbConfigurationError extends ProviderPermanentError {
  constructor() {
    super(
      "TMDB_API_READ_TOKEN or TMDB_API_KEY must be configured",
      "configuration"
    );
    this.name = "TmdbConfigurationError";
  }
}
