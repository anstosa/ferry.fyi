import { useEffect, useState } from "react";
import { debounce } from "shared/lib/timing";

interface ScrollPosition {
  x: number;
  y: number;
}

export const useScrollPosition = (
  element: React.MutableRefObject<any>
): ScrollPosition => {
  const [position, setPosition] = useState<ScrollPosition>({ x: 0, y: 0 });

  // bind scroll listener
  useEffect(() => {
    const target = element.current;
    // missing target guard
    if (!target) {
      return;
    }
    const updatePosition = debounce(
      () => {
        setPosition({
          x: target.scrollLeft,
          y: target.scrollTop,
        });
      },
      { leading: true }
    );
    target.addEventListener("scroll", updatePosition);

    return () => {
      // remove captured listener
      target.removeEventListener("scroll", updatePosition);
    };
  }, [element.current]);

  return position;
};
