const REQUEST_TIMEOUT_MS = 10_000;

// bound cloud request and body processing before releasing the operation lease
export const withGoogleCloudRequestTimeout = async <Result>(
  request: (signal: AbortSignal) => Promise<Result>
): Promise<Result> => {
  const controller = new AbortController();
  // cancel stalled provider work rather than indefinitely renewing its lease
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};
