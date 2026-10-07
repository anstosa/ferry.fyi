import type { PluginListenerHandle } from "@capacitor/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { trackUsefulEvent, type UsefulContentSurface } from "~/lib/analytics";
import { isNativeMobileApp } from "~/lib/device";

// measure one uninterrupted visible episode without inventing session identity
export const useUsefulContent = (
  surface: UsefulContentSurface,
  identity: string,
  ready: boolean
): ((node: HTMLElement | null) => void) => {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const current = useRef({ surface, identity, ready });
  // publish only committed eligibility to pending timers
  useLayoutEffect(() => {
    current.current = { surface, identity, ready };
  }, [identity, ready, surface]);
  // react to meaningful node replacement without resetting ordinary rerenders
  const ref = useCallback((element: HTMLElement | null): void => {
    setNode(element);
  }, []);

  // reset the episode on any content or eligibility boundary
  useEffect(() => {
    // never infer viewport visibility when observation is unavailable
    if (
      !node ||
      !ready ||
      !identity ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    let disposed = false;
    let intersecting = false;
    let foreground = !isNativeMobileApp();
    let nativeStateKnown = foreground;
    let qualified = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nativeListener: PluginListenerHandle | undefined;
    let nativeRevision = 0;

    // recheck current props and browser visibility at the timer boundary
    const eligible = (): boolean =>
      !disposed &&
      current.current.ready &&
      current.current.identity === identity &&
      current.current.surface === surface &&
      document.visibilityState === "visible" &&
      intersecting &&
      foreground &&
      nativeStateKnown;

    // interruptions reset rather than pause elapsed time and the episode latch
    const reset = (): void => {
      clearTimeout(timer);
      timer = undefined;
      qualified = false;
    };

    // start only one five-second timer for the current uninterrupted episode
    const reconcile = (): void => {
      // all gates must stay eligible
      if (!eligible()) {
        reset();
        return;
      }
      // keep a completed or running episode stable across polling and rerenders
      if (qualified || timer !== undefined) {
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        let interrupted = false;
        // consume pending viewport changes before the final eligibility check
        for (const entry of observer.takeRecords()) {
          // ignore any stale or unrelated target
          if (entry.target === node) {
            intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
            // even an offscreen-then-visible batch interrupts continuity
            if (!intersecting) {
              interrupted = true;
            }
          }
        }
        // restart after any queued interruption rather than accepting only its last state
        if (interrupted) {
          reset();
          reconcile();
          return;
        }
        // stale props or lifecycle changes cannot qualify late
        if (!eligible()) {
          reset();
          return;
        }
        qualified = true;
        trackUsefulEvent("useful_content_view", { surface });
      }, 5_000);
    };

    // observe only the actual meaningful content region
    const observer = new IntersectionObserver(
      (entries) => {
        // ignore callbacks after cleanup
        if (disposed) {
          return;
        }
        // apply each target transition before reconciling eligibility
        for (const entry of entries) {
          // ignore stale or unrelated observer entries
          if (entry.target !== node) {
            continue;
          }
          intersecting = entry.isIntersecting && entry.intersectionRatio > 0;
          reconcile();
        }
      },
      // notify both at the zero-area boundary and first positive visibility
      { threshold: [0, Number.EPSILON] }
    );
    observer.observe(node);
    document.addEventListener("visibilitychange", reconcile);

    // native foreground is unknown until the existing app plugin confirms it
    if (!foreground) {
      import("@capacitor/app")
        .then(async ({ App }) => {
          // avoid registering a listener after disposal
          if (disposed) {
            return;
          }
          nativeListener = await App.addListener(
            "appStateChange",
            ({ isActive }) => {
              // ignore late native callbacks
              if (disposed) {
                return;
              }
              nativeRevision += 1;
              foreground = isActive;
              reconcile();
            }
          );
          // remove an asynchronously resolved handle after cleanup
          if (disposed) {
            await nativeListener.remove();
            return;
          }
          const revision = nativeRevision;
          const state = await App.getState();
          // ignore initial state after cleanup
          if (disposed) {
            return;
          }
          nativeStateKnown = true;
          // preserve a newer foreground notification over the initial snapshot
          if (nativeRevision === revision) {
            foreground = state.isActive;
          }
          reconcile();
        })
        .catch(() => {
          // unknown native state stays ineligible
        });
    }

    // detach all state sources and prevent late emissions
    return () => {
      disposed = true;
      reset();
      observer.disconnect();
      document.removeEventListener("visibilitychange", reconcile);
      nativeListener?.remove().catch(() => undefined);
    };
  }, [node, surface, identity, ready]);

  return ref;
};
