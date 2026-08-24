import { DateTime } from "luxon";
import type { AlertRule } from "shared/contracts/user";
import {
  hasAlertRuleSubscription,
  normalizeAlertRule,
} from "shared/lib/alertSubscriptions";
import { describe, expect, it } from "vitest";

const rule: AlertRule = {
  channels: ["delays"],
  daysOfWeek: [1],
  enabled: false,
  endTime: "09:00",
  id: "morning",
  nickname: " Morning commute ",
  routeKey: "1:2",
  startTime: "07:00",
  terminalIds: ["1"],
};

describe("alert rule windows", () => {
  it("does not match a disabled window", () => {
    expect(
      hasAlertRuleSubscription([rule], {
        channel: "delays",
        currentTime: DateTime.fromISO("2026-07-13T08:00:00", {
          zone: "America/Los_Angeles",
        }),
        terminalIds: ["1", "2"],
      })
    ).toBe(false);
  });

  it("keeps a trimmed nickname when normalizing a rule", () => {
    expect(normalizeAlertRule(rule).nickname).toBe("Morning commute");
  });

  // omit empty normalized nicknames
  it.each(["", "   "])("omits the nickname for %j", (nickname) => {
    expect(normalizeAlertRule({ ...rule, nickname })).not.toHaveProperty(
      "nickname"
    );
  });
});
