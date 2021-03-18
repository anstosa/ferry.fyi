export const round = (input: number, decimals: number = 0): number => {
  const scale = Math.pow(10, decimals);
  return Math.round((input + Number.EPSILON) * scale) / scale;
};
