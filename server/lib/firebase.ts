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
