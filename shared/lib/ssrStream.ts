import { PassThrough } from "node:stream";

import type { ReactElement } from "react";
import { renderToPipeableStream } from "react-dom/server";

type PipeableRender = ReturnType<typeof renderToPipeableStream>;

export type SsrStreamRenderer = (
  element: ReactElement,
  options: Parameters<typeof renderToPipeableStream>[1]
) => PipeableRender;

/** Buffers only an all-ready React stream and rejects without returning partial HTML. */
export const renderSsrStreamToString = (
  element: ReactElement,
  renderer: SsrStreamRenderer = renderToPipeableStream
): Promise<string> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let stream: PipeableRender | undefined;
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      const failure =
        error instanceof Error ? error : new Error("SSR render failed");
      try {
        stream?.abort();
      } catch {
        // Abort is best-effort cleanup; preserve the original render failure.
      }
      reject(failure);
    };

    try {
      stream = renderer(element, {
        onAllReady() {
          if (settled) {
            return;
          }
          const output = new PassThrough();
          const chunks: Buffer[] = [];
          output.on("data", (chunk: Buffer | string) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          );
          output.on("error", fail);
          output.on("end", () => {
            if (!settled) {
              settled = true;
              resolve(Buffer.concat(chunks).toString("utf8"));
            }
          });
          try {
            stream?.pipe(output);
          } catch (error) {
            fail(error);
          }
        },
        onError: fail,
        onShellError: fail,
      });
    } catch (error) {
      fail(error);
    }
  });
