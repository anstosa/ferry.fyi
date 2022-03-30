import { auth0 } from "~/lib/auth0";
import { Bulletin as BulletinClass } from "shared/contracts/bulletins";
import { CacheableModel } from "./CacheableModel";
import { convert } from "html-to-text";
import { DateTime } from "luxon";
import { sendPush } from "~/lib/push";

const startupTime = DateTime.now().toUnixInteger();

type BulletinInput = Omit<BulletinClass, "descriptionText">;

export class Bulletin extends CacheableModel implements BulletinClass {
  static cacheKey = "bulletins";
  static index = "id";

  date!: number;
  descriptionHTML!: string;
  descriptionText!: string;
  id!: string;
  terminalId!: string;
  title!: string;
  url?: string;

  constructor(data: BulletinInput) {
    const id = Bulletin.generateIndex(data);
    const descriptionText = convert(data.descriptionHTML, { wordwrap: false });
    super({ ...data, id, descriptionText });
    this.sendPushes();
  }

  async sendPushes(): Promise<void> {
    if (this.date < startupTime) {
      // don't send pushes for old bulletins
      return;
    }

    const users = await auth0.getUsers();
    users.forEach((user) => {
      const subscribedTerminals = user.app_metadata?.subscribedTerminals || [];
      const token = user.app_metadata?.fcmToken;
      if (!subscribedTerminals.includes(this.terminalId)) {
        // user not subscribed to this terminal
        return;
      }
      if (!token) {
        // user does not have an FCM Token saved
        console.warn("Subscribed user without FCM Token", user.user_id);
        return;
      }
      sendPush({
        token,
        data: {
          title: this.title,
          body: this.descriptionText,
          date: String(this.date),
          ...(this.url ? { url: this.url } : {}),
          terminalId: this.terminalId,
        },
      });
    });
  }

  static generateIndex = (data: BulletinInput): string =>
    `${data.date}-${data.terminalId}-${data.title}`;

  serialize(): BulletinClass {
    return CacheableModel.serialize({
      date: this.date,
      descriptionHTML: this.descriptionHTML,
      descriptionText: this.descriptionText,
      terminalId: this.terminalId,
      title: this.title,
      ...(this.url && { url: this.url }),
    });
  }
}
