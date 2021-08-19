import { debounce } from "./timing";
import { useEffect, useState } from "react";

interface ScrollPosition {
  x: number;
  y: number;
}

export const useScrollPosition = (
  element: React.MutableRefObject<any>
): ScrollPosition => {
  const [position, setPosition] = useState<ScrollPosition>({ x: 0, y: 0 });

  useEffect(() => {
    const updatePosition = debounce(
      () => {
        setPosition({
          x: element.current.scrollLeft,
          y: element.current.scrollTop,
        });
      },
      { leading: true }
    );
    element.current.addEventListener("scroll", updatePosition);

    return () => {
      element.current.removeEventListener("scroll", updatePosition);
    };
  }, [element]);

  return position;
};
