import {
  type AddressSuggestionsResponse,
  isAddressSuggestion,
} from "shared/contracts/addressSuggestions";

import { post } from "./api";

// request ephemeral suggestions through the existing web and native adapter
export const getAddressSuggestions = async (
  input: string
): Promise<AddressSuggestionsResponse> => {
  try {
    const value = await post<AddressSuggestionsResponse>(
      "/sailing-recommendations/address-suggestions",
      { input }
    );
    // reject raw or malformed provider payloads before retaining suggestions
    if (
      !value ||
      typeof value !== "object" ||
      Object.keys(value).length !== 2 ||
      typeof value.available !== "boolean" ||
      !Array.isArray(value.suggestions) ||
      value.suggestions.length > 5 ||
      !value.suggestions.every(isAddressSuggestion) ||
      (!value.available && value.suggestions.length !== 0)
    ) {
      return { available: false, suggestions: [] };
    }
    return value;
  } catch {
    return { available: false, suggestions: [] };
  }
};
