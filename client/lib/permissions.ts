import type { PermissionState } from "@capacitor/core";

type PermissionStatus<Key extends string> = Record<Key, PermissionState>;

const isPromptable = (permission: PermissionState): boolean =>
  permission === "prompt" || permission === "prompt-with-rationale";

export const requestPermissionIfNeeded = async <Key extends string>(
  key: Key,
  checkPermissions: () => Promise<PermissionStatus<Key>>,
  requestPermissions: () => Promise<PermissionStatus<Key>>
): Promise<boolean> => {
  let permissions = await checkPermissions();
  if (permissions[key] === "granted") {
    return true;
  }

  if (isPromptable(permissions[key])) {
    permissions = await requestPermissions();
  }

  return permissions[key] === "granted";
};
