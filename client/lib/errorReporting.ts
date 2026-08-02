type ExceptionReporter = (error: unknown) => void;

const MAX_BUFFERED_EXCEPTIONS = 20;
const bufferedExceptions: unknown[] = [];
let exceptionReporter: ExceptionReporter | undefined;

export const captureReportedException = (error: unknown): void => {
  if (exceptionReporter) {
    exceptionReporter(error);
    return;
  }
  bufferedExceptions.push(error);
  if (bufferedExceptions.length > MAX_BUFFERED_EXCEPTIONS) {
    bufferedExceptions.shift();
  }
};

export const installExceptionReporter = (
  reporter: ExceptionReporter
): (() => void) => {
  exceptionReporter = reporter;
  bufferedExceptions.splice(0).forEach((error) => reporter(error));
  return () => {
    if (exceptionReporter === reporter) {
      exceptionReporter = undefined;
    }
  };
};
