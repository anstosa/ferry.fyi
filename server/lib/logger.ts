type LogLevel = "debug" | "error" | "info" | "warn";

type LogMetadata = object;

interface Logger {
  debug: (message: string, data?: LogMetadata) => void;
  error: (message: string, data?: LogMetadata) => void;
  info: (message: string, data?: LogMetadata) => void;
  warn: (message: string, data?: LogMetadata) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

// remember warned invalid values
const warnedInvalidLogLevels = new Set<string>();

// report invalid configuration directly
const warnInvalidLogLevel = (configured: string): void => {
  // warn once per invalid value
  if (warnedInvalidLogLevels.has(configured)) {
    return;
  }
  warnedInvalidLogLevels.add(configured);
  const output = JSON.stringify({
    configuredLogLevel: configured,
    level: "warn",
    message: "Invalid LOG_LEVEL; falling back to info",
  });
  // avoid recursive logger use
  // eslint-disable-next-line no-console
  console.log(output);
};

// resolve the configured log threshold
const getLogThreshold = (): number => {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  // reject unsupported levels
  if (!Object.prototype.hasOwnProperty.call(LOG_LEVELS, configured)) {
    warnInvalidLogLevel(configured);
    return LOG_LEVELS.info;
  }
  return LOG_LEVELS[configured as LogLevel];
};

// build one cycle-safe JSON replacer
const createLogReplacer = (): ((key: string, value: unknown) => unknown) => {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    // preserve error details
    if (value instanceof Error) {
      return {
        message: value.message,
        name: value.name,
        stack: value.stack,
      };
    }
    // preserve bigint values
    if (typeof value === "bigint") {
      return value.toString();
    }
    // guard circular metadata
    if (value && typeof value === "object") {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  };
};

// write one CloudWatch-friendly record
const writeLog = (
  level: LogLevel,
  message: string,
  data?: LogMetadata
): void => {
  // enforce the configured threshold
  if (LOG_LEVELS[level] < getLogThreshold()) {
    return;
  }
  const metadata = data instanceof Error ? { error: data } : (data ?? {});
  const output = JSON.stringify(
    { ...metadata, level, message },
    createLogReplacer()
  );
  // CloudWatch captures the container output stream
  // eslint-disable-next-line no-console
  console.log(output);
};

const logger: Logger = {
  // write a debug record
  debug: (message, data) => writeLog("debug", message, data),
  // write an error record
  error: (message, data) => writeLog("error", message, data),
  // write an info record
  info: (message, data) => writeLog("info", message, data),
  // write a warning record
  warn: (message, data) => writeLog("warn", message, data),
};

export default logger;
