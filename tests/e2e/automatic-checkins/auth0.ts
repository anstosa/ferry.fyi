import { automaticFixtureState } from "./state";

// issue one fixture access token
const getAccessTokenSilently = async (): Promise<string> => {
  automaticFixtureState.calls.push("auth:token");
  return "fixture-access-token";
};

// retain one exact fixture owner
const auth = {
  getAccessTokenSilently,
  isAuthenticated: true,
  user: { sub: "auth0|automatic-browser-fixture" },
};

// expose one stable authenticated fixture owner
export const useAuth0 = () => auth;
