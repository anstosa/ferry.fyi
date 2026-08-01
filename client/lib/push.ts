import {
  getMessaging,
  getToken,
  isSupported,
  MessagePayload,
  onMessage,
} from "firebase/messaging";
import { useEffect, useRef, useState } from "react";
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
const INITIALIZE_PUSH_EVENT = "ferryfyi:initialize-push";

/** Ask the app-level push owner to complete FCM setup after permission changes. */
export const requestPushInitialization = (): void => {
  window.dispatchEvent(new Event(INITIALIZE_PUSH_EVENT));
};

export const getNotificationPermission = (): NotificationPermission | null => {
  if (typeof Notification === "undefined") {
    return null;
  }
  return Notification.permission;
};

export const requestNotificationPermission = async (): Promise<boolean> => {
  const permission = getNotificationPermission();
  if (permission === "granted") {
    return true;
  }
  // Browsers do not show another permission prompt after the user has denied
  // notifications. Calling requestPermission() again in that state only looks
  // like a broken button, so recovery belongs in browser/app settings.
  if (permission !== "default") {
    return false;
  }
  return (await Notification.requestPermission()) === "granted";
};

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
  const [initializationRequest, setInitializationRequest] = useState(
    requestPermission ? 1 : 0
  );
  const shouldRequestPermission = initializationRequest > 0;
  const initialization = useRef<Promise<void> | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const initialize = (): void =>
      setInitializationRequest((current) => current + 1);
    window.addEventListener(INITIALIZE_PUSH_EVENT, initialize);
    return () => window.removeEventListener(INITIALIZE_PUSH_EVENT, initialize);
  }, []);

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
        // Permission prompts must originate in a user gesture. Callers request
        // permission in their button handlers; this effect only completes FCM
        // setup after permission has already been granted.
        if (getNotificationPermission() !== "granted") {
          return;
        }
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
    if (!fcmToken && shouldRequestPermission && !initialization.current) {
      const pending = initialize().finally(() => {
        if (initialization.current === pending) {
          initialization.current = null;
        }
      });
      initialization.current = pending;
    }
  }, [initializationRequest]);

  return requestPushInitialization;
};
