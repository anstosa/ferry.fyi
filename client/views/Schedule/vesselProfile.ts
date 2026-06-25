// format rounded length
export const formatVesselLength = (length?: string): string | null => {
  // missing length guard
  if (!length) {
    return null;
  }
  const feetMatch = length.match(/([\d.]+)\s*'/);
  const inchMatch = length.match(/([\d.]+)\s*"/);
  // feet-and-inches guard
  if (feetMatch) {
    const feet = Number(feetMatch[1]);
    const inches = inchMatch ? Number(inchMatch[1]) : 0;
    return `${Math.ceil(feet + inches / 12)} ft`;
  }
  const numericLength = Number.parseFloat(length);
  // numeric fallback guard
  if (!Number.isNaN(numericLength)) {
    return `${Math.ceil(numericLength)} ft`;
  }
  return length;
};
