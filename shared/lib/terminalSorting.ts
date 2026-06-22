import type { Terminal } from "../contracts/terminals";

type SortableTerminal = Pick<Terminal, "id" | "name">;

// compare terminal names
export const compareTerminalsByName = (
  left: SortableTerminal,
  right: SortableTerminal
): number => left.name.localeCompare(right.name);

// build terminal sorter
export const getTerminalSorter =
  (closestTerminal?: Pick<Terminal, "id"> | null) =>
  (left: SortableTerminal, right: SortableTerminal): number => {
    // closest terminal first
    if (left.id === closestTerminal?.id) {
      return -1;
    }

    // closest terminal first
    if (right.id === closestTerminal?.id) {
      return 1;
    }

    return compareTerminalsByName(left, right);
  };
