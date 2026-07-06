import {
  getMessaging,
  getToken,
  isSupported,
  MessagePayload,
  onMessage,
} from "firebase/messaging";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { firebaseApp } from "./firebase";
import { useUser } from "./user";
import { getRegistration } from "./worker";

interface Notification extends MessagePayload {
  data: {
    title: string;
    body: string;
    url: string;
  };
}

const isNotification = (payload: MessagePayload): payload is Notification =>
  Boolean(
    payload.data &&
    "title" in payload.data &&
    "body" in payload.data &&
    "url" in payload.data
  );

type InitializePush = () => void;

// supported messaging loader
const getSupportedMessaging = async () => {
  // browser support guard
  if (!(await isSupported())) {
    return null;
  }
  return getMessaging(firebaseApp);
};

export const usePush = (requestPermission: boolean): InitializePush => {
  const [{ user, isAuthenticated, fcmToken: savedFcmToken }, { updateUser }] =
    useUser();
  const [fcmToken, setFcmToken] = useState<string>("");
  const [shouldRequestPermission, setRequestPermission] =
    useState<boolean>(requestPermission);
  const navigate = useNavigate();

  useEffect(() => {
    if (
      shouldRequestPermission &&
      fcmToken &&
      isAuthenticated &&
      fcmToken !== savedFcmToken
    ) {
      updateUser({
        app_metadata: {
          fcmToken,
        },
      });
    }
  }, [
    fcmToken,
    isAuthenticated,
    savedFcmToken,
    shouldRequestPermission,
    updateUser,
    user?.user_id,
  ]);

  useEffect(() => {
    // push initializer
    const initialize = async () => {
      try {
        const messaging = await getSupportedMessaging();

        // unsupported browser guard
        if (!messaging) {
          return;
        }

        const serviceWorkerRegistration = await getRegistration();

        // registration guard
        if (!serviceWorkerRegistration) {
          return;
        }

        const token = await getToken(messaging, {
          vapidKey: process.env.FIREBASE_VAPID_KEY,
          serviceWorkerRegistration,
        });

        // token guard
        if (!token) {
          console.warn("Failed to get FCM Token");
          return;
        }
        setFcmToken(token);
        onMessage(messaging, (payload) => {
          if (isNotification(payload)) {
            console.log("Foreground notification: ", payload.data);
            const notification = new Notification(payload.data.title, {
              body: payload.data.body,
              badge: "/static/images/notification-badge.png",
              icon: "/static/images/icon-192x192.png",
            });
            notification.addEventListener("click", () => {
              navigate(
                payload.data.url.replace(process.env.BASE_URL as string, "")
              );
            });
          } else {
            console.warn("Unhandled foreground message: ", payload);
          }
        });
      } catch (error) {
        console.warn("Failed to get FCM Token: ", error);
      }
    };
    if (!fcmToken && shouldRequestPermission) {
      initialize();
    }
  }, [shouldRequestPermission]);

  return () => setRequestPermission(true);
};
