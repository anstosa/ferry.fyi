import { type GetTokenSilentlyOptions, useAuth0 } from "@auth0/auth0-react";
import { useCallback } from "react";

// require a token before entering authenticated application flows
export const useRequiredAuth0 = () => {
  const auth = useAuth0();
  // preserve token-provider identity across renders
  const getAccessTokenSilently = useCallback(
    async (
      options?: Omit<GetTokenSilentlyOptions, "detailedResponse">
    ): Promise<string> => {
      const token = await auth.getAccessTokenSilently(options);
      // trigger existing sign-in recovery instead of an anonymous request
      if (!token) {
        throw Object.assign(
          new Error("login_required: Sign in again to continue."),
          { error: "login_required" }
        );
      }
      return token;
    },
    [auth.getAccessTokenSilently]
  );

  return { ...auth, getAccessTokenSilently };
};
