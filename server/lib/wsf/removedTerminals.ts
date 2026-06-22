export const removedTerminalIds = ["19"];

// identify retired terminals
export const isRemovedTerminalId = (terminalId: string): boolean =>
  removedTerminalIds.includes(terminalId);
