import { firebaseApp } from "./firebase";
import {
  getMessaging,
  getToken,
  MessagePayload,
  onMessage,
} from "firebase/messaging";
import { getRegistration } from "./worker";
import {
  PushNotifications as NativePush,
  PushNotificationSchema,
} from "@capacitor/push-notifications";
import { useDevice } from "./device";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "./user";

const messaging = getMessaging(firebaseApp);
export interface Notification extends MessagePayload {
  notification: MessagePayload["notification"] & {
    title: string;
    body: string;
  };
  data: {
    date: string;
    url: string;
    terminalId: string;
  };
}

type NativeNotification = Notification & PushNotificationSchema;

export const isNotification = (
  payload: MessagePayload
): payload is Notification =>
  Boolean(
    payload.notification &&
      payload.notification.title &&
      payload.notification.body &&
      payload.data &&
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
  const device = useDevice();

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
    if (!device) {
      return;
    }
    const initialize = async () => {
      if (device.isNativeMobile) {
        let status = await NativePush.checkPermissions();

        if (status.receive === "prompt") {
          status = await NativePush.requestPermissions();
        }

        if (status.receive !== "granted") {
          await NativePush.addListener("registration", (token) => {
            setFcmToken(token.value);
          });

          await NativePush.addListener("registrationError", (err) => {
            console.error("Registration error: ", err.error);
          });

          await NativePush.addListener(
            "pushNotificationReceived",
            (notification) => {
              const payload = notification as NativeNotification;
              if (isNotification(payload)) {
                console.log(
                  "Foreground notification: ",
                  payload.notification,
                  payload.data
                );
                const notification = new Notification(
                  payload.notification.title,
                  {
                    body: payload.notification.body,
                    icon: "/static/images/icon.png",
                  }
                );
                notification.addEventListener("click", () => {
                  navigate(
                    payload.data.url.replace(process.env.BASE_URL as string, "")
                  );
                });
              } else {
                console.warn("Unhandled foreground message: ", payload);
              }
            }
          );

          await NativePush.addListener(
            "pushNotificationActionPerformed",
            (notification) => {
              console.log(
                "Push notification action performed",
                notification.actionId,
                notification.inputValue
              );
            }
          );
        }

        await NativePush.register();
      } else {
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
              console.log(
                "Foreground notification: ",
                payload.notification,
                payload.data
              );
              const notification = new Notification(
                payload.notification.title,
                {
                  body: payload.notification.body,
                  icon: "/static/images/icon.png",
                }
              );
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
      }
    };
    if (!fcmToken && shouldRequestPermission) {
      initialize();
    }
  }, [shouldRequestPermission, device?.isNativeMobile]);

  return () => setRequestPermission(true);
};
