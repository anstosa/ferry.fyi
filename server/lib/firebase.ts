import {
  App,
  cert,
  initializeApp,
  type ServiceAccount,
} from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { isKeyOf, isObject } from "shared/lib/objects";

const firebaseServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

export const parseFirebaseServiceAccount = (
  encodedServiceAccount: string,
  configuredProjectId = process.env.FIREBASE_PROJECT_ID
): ServiceAccount => {
  const serviceAccount: unknown = JSON.parse(
    Buffer.from(encodedServiceAccount, "base64").toString()
  );
  if (
    !isObject(serviceAccount) ||
    !isKeyOf(serviceAccount, "project_id") ||
    typeof serviceAccount.project_id !== "string"
  ) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT has no project_id");
  }
  if (
    configuredProjectId &&
    serviceAccount.project_id !== configuredProjectId
  ) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT project does not match FIREBASE_PROJECT_ID"
    );
  }
  return serviceAccount as ServiceAccount;
};

// require credentials in production
if (!firebaseServiceAccount && process.env.NODE_ENV === "production") {
  throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
}
if (!process.env.FIREBASE_PROJECT_ID && process.env.NODE_ENV === "production") {
  throw new Error("FIREBASE_PROJECT_ID is not set");
}

let firebase: App | undefined;

// initialize Firebase when configured
if (firebaseServiceAccount) {
  firebase = initializeApp({
    credential: cert(parseFirebaseServiceAccount(firebaseServiceAccount)),
  });
}

const noOpFirebaseMessaging = {
  // Never report a discarded local send as accepted. The final push boundary
  // maps this explicit provider state to "unavailable" for the admin UI.
  send(): Promise<string> {
    return Promise.reject({ code: "messaging/provider-unavailable" });
  },
};

export { firebase };
export const firebaseMessaging = firebase
  ? getMessaging(firebase)
  : noOpFirebaseMessaging;

export const hasFirebaseCode = (error: unknown, code: string): boolean => {
  if (!isObject(error)) {
    return false;
  }
  if (isKeyOf(error, "code") && error.code === code) {
    return true;
  }
  if (
    isKeyOf(error, "errorInfo") &&
    isKeyOf(error.errorInfo, "code") &&
    error.errorInfo.code === code
  ) {
    return true;
  }
  return false;
};
