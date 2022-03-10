import { useAuth0 } from "@auth0/auth0-react";
import clsx from "clsx";
import React, { ReactElement } from "react";

export const LoginPrompt = (): ReactElement | null => {
  const { isAuthenticated, loginWithRedirect } = useAuth0();

  if (isAuthenticated) {
    return null;
  }
  return (
    <li
      className={clsx(
        "my-4 w-full",
        "text-center font-bold",
        "p-4 rounded cursor-pointer",
        "bg-blue-medium dark:bg-blue-light",
        "outline outline-blue-dark dark:outline-blue-medium",
        "text-black"
      )}
      onClick={() => loginWithRedirect({ redirectUri: window.location.href })}
    >
      Create a free account to save tickets
    </li>
  );
};
