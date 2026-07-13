export type OuraOptionalFetchAuthError = {
  httpStatus: number;
  endpoint: string;
  message: string;
};

// Duck-typed rather than `instanceof OuraApiError` so this module has no
// runtime dependency on ./client — keeps it a leaf module that the
// experimental-strip-types test runner can load without path resolution.
function isOuraApiErrorLike(err: unknown): err is Error & { status: number } {
  return err instanceof Error && typeof (err as { status?: unknown }).status === 'number';
}

// 401 means the token lacks a scope we asked for — a real, actionable
// problem (see the heart_health/stress scope gap this fixes). 403/404 mean
// the feature genuinely isn't available for this account; that's fine to
// treat as empty data. Anything else is unexpected and should propagate.
export function classifyOptionalOuraError(
  err: unknown,
  endpoint: string,
): { data: unknown[]; authError?: OuraOptionalFetchAuthError } {
  if (isOuraApiErrorLike(err)) {
    if (err.status === 401) {
      return {
        data: [],
        authError: { httpStatus: 401, endpoint, message: err.message },
      };
    }

    if (err.status === 403 || err.status === 404) {
      return { data: [] };
    }
  }

  throw err;
}
