export interface AddressSuggestion {
  address: string;
  placeId: string;
  primaryText: string;
  secondaryText: string;
}

export interface AddressSuggestionsResponse {
  available: boolean;
  suggestions: AddressSuggestion[];
}

// accept only bounded plain text at the provider and browser boundaries
export const isAddressSuggestion = (
  value: unknown
): value is AddressSuggestion => {
  // reject arrays and undeclared provider fields
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const entry = value as AddressSuggestion;
  return (
    Object.keys(entry).length === 4 &&
    isGooglePlaceId(entry.placeId) &&
    typeof entry.address === "string" &&
    entry.address.trim().length > 0 &&
    entry.address.length <= 200 &&
    typeof entry.primaryText === "string" &&
    entry.primaryText.trim().length > 0 &&
    entry.primaryText.length <= 200 &&
    typeof entry.secondaryText === "string" &&
    entry.secondaryText.length <= 200
  );
};

// accept opaque google place identifiers without path or control characters
export const isGooglePlaceId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,255}$/.test(value);
