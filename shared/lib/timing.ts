export const debounce = (
  callback: () => void,
  {
    wait = 300,
    leading = false,
    trailing = true,
  }: { leading?: boolean; trailing?: boolean; wait?: number } = {}
): (() => void) => {
  let timeout: number | undefined;

  return (...args): void => {
    const later = () => {
      timeout = undefined;
      if (trailing) {
        callback.apply(this, args);
      }
    };
    const callNow = leading && !timeout;
    clearTimeout(timeout);
    timeout = window.setTimeout(later, wait);
    if (callNow) {
      callback.apply(this, args);
    }
  };
};
