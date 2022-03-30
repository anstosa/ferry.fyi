import { firebaseApp } from "./firebase";
import {
  getMessaging,
  getToken,
  MessagePayload,
  onMessage,
} from "firebase/messaging";
import { getRegistration } from "./worker";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "./user";

const messaging = getMessaging(firebaseApp);
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
  }, [fcmToken, updateUser, user?.user_id, shouldRequestPermission]);

  useEffect(() => {
    const initialize = async () => {
      try {
        const token = await getToken(messaging, {
          vapidKey: process.env.FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: getRegistration(),
        });
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
              icon: "/static/images/icon.png",
            });
            notification.addEventListener("click", () => {
              navigate(payload.data.url);
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
