import {
  getBulletinSourceUpdatedAt,
  updateTerminals,
} from "~/lib/wsf/updateTerminals";

export const getPublicBulletinFreshness = (): {
  sourceUpdatedAt: number | null;
} => ({
  sourceUpdatedAt: getBulletinSourceUpdatedAt(),
});

export const refreshPublicBulletins = async (): Promise<{
  sourceUpdatedAt: number | null;
}> => {
  await updateTerminals({ forceBulletins: true });
  return getPublicBulletinFreshness();
};
