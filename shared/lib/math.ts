export const round = (input: number, decimals: number = 0): number => {
  const scale = Math.pow(10, decimals);
  return Math.round((input + Number.EPSILON) * scale) / scale;
};

export const mean = (input: number[]): number => {
  let sum = 0;
  input.forEach((number) => (sum += number));
  return sum / input.length;
};
