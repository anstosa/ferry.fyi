// readable error message
export const getErrorMessage = (error: unknown): string => {
  // error object guard
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

// structured log error
export const getLogError = (error: unknown): Error | undefined => {
  // error object guard
  if (error instanceof Error) {
    return error;
  }
  return undefined;
};
