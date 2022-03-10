import { User as Auth0User } from "auth0";
import { get, post } from "~/lib/api";
import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useState } from "react";

interface AppMetadata {
  tickets?: string[];
}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface UserMetadata {}
type User = Auth0User<AppMetadata, UserMetadata>;

interface State extends AppMetadata, UserMetadata {
  isAuthenticated: boolean;
  user: null | User;
}
interface Actions {
  updateUser: (data: Partial<User>) => Promise<void>;
}

type Response = [State, Actions];

export const useUser = (): Response => {
  const [user, setUser] = useState<User | null>(null);
  const {
    user: auth0User,
    getAccessTokenSilently,
    isAuthenticated,
  } = useAuth0();
  const [accessToken, setAccessToken] = useState<string>("");

  const getUserMetadata = async () => {
    if (!auth0User?.sub) {
      return;
    }
    try {
      const accessToken = await getAccessTokenSilently();
      setAccessToken(accessToken);

      const user = await get("/user", accessToken);
      setUser(user);
    } catch (error) {
      console.error(error);
    }
  };

  // fetch metadata
  useEffect(() => {
    getUserMetadata();
  }, [getAccessTokenSilently, auth0User?.sub]);

  const state: State = {
    isAuthenticated,
    user,
    ...user?.app_metadata,
    ...user?.user_metadata,
  };

  const actions: Actions = {
    updateUser: async (data) => {
      return await post("/user", data, accessToken);
    },
  };

  return [state, actions];
};
