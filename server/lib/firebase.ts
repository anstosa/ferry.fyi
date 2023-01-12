import { isKeyOf, isObject } from "shared/lib/objects";
import admin from "firebase-admin";

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT is not set");
}

export const firebase = admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(
      Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT as string,
        "base64"
      ).toString()
    )
  ),
});

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
