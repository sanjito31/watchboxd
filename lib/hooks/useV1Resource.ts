"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UiResourceState } from "./ui-types";
import {
  fetchV1Resource,
  V1ApiError,
  type V1PollingOptions,
} from "./v1-client";

const IDLE_STATE: UiResourceState<never> = { status: "idle", jobs: [] };

interface ResourceSnapshot<T> {
  url: string;
  value: UiResourceState<T>;
}

interface UseV1ResourceOptions
  extends Pick<
    V1PollingOptions,
    "timeoutMs" | "initialIntervalMs" | "maxIntervalMs"
  > {
  enabled?: boolean;
}

export interface UseV1ResourceResult<T> extends UiResourceState<T> {
  retry: () => void;
  cancel: () => void;
}

/**
 * Browser resource hook for the asynchronous v1 API contract. Requests are
 * cancelled when the URL changes or the component unmounts.
 */
export function useV1Resource<T>(
  url: string | null,
  options: UseV1ResourceOptions = {}
): UseV1ResourceResult<T> {
  const enabled = options.enabled ?? true;
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<ResourceSnapshot<T> | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const run = useCallback(
    async (controller: AbortController) => {
      const requestUrl = url!;
      const update = (value: UiResourceState<T>) => {
        setSnapshot({ url: requestUrl, value });
      };
      update({ status: "loading", jobs: [] });

      try {
        const result = await fetchV1Resource<T>(requestUrl, {
          signal: controller.signal,
          timeoutMs: options.timeoutMs,
          initialIntervalMs: options.initialIntervalMs,
          maxIntervalMs: options.maxIntervalMs,
          onPending: (jobs) => {
            if (!controller.signal.aborted) {
              update({ status: "pending", jobs });
            }
          },
        });

        if (!controller.signal.aborted) {
          update({
            status: "success",
            data: result.data,
            meta: result.meta,
            jobs: [],
          });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        update({
          status: "error",
          jobs: [],
          error:
            error instanceof V1ApiError
              ? error
              : new V1ApiError(
                  "network_error",
                  "Could not load this resource. Try again.",
                  { recoverable: true, cause: error }
                ),
        });
      }
    },
    [
      url,
      options.timeoutMs,
      options.initialIntervalMs,
      options.maxIntervalMs,
    ]
  );

  useEffect(() => {
    if (!enabled || !url) return;

    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    void run(controller);

    return () => {
      controller.abort();
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    };
  }, [enabled, revision, run, url]);

  const retry = useCallback(() => {
    activeRequest.current?.abort();
    setRevision((value) => value + 1);
  }, []);

  const cancel = useCallback(() => {
    activeRequest.current?.abort();
  }, []);

  const state =
    enabled && url && snapshot?.url === url ? snapshot.value : IDLE_STATE;
  return { ...state, retry, cancel };
}
