"use strict";

const wsfCore = require("../../shared/data/wsf-core.json");

const ALERT_CHANNELS = [
  "cancellations",
  "delays",
  "service-alerts",
  "wait-times",
];
const EVERY_DAY_DAYS = [1, 2, 3, 4, 5, 6, 7];
const FULL_DAY_START_TIME = "00:00";
const FULL_DAY_END_TIME = "24:00";

const getRouteKey = (terminalIds) => [...terminalIds].sort().join(":");

const getRouteGroups = () => {
  return Object.values(wsfCore.routes).map((route) => route.terminalIds);
};

const getTerminalPairGroups = (terminalId) => {
  const pairGroups = getRouteGroups().flatMap((terminalIds) => {
    // route membership guard
    if (!terminalIds.includes(terminalId)) {
      return [];
    }
    return terminalIds
      .filter((mateId) => mateId !== terminalId)
      .map((mateId) => [terminalId, mateId]);
  });
  // unknown terminal guard
  if (pairGroups.length === 0) {
    return [[terminalId]];
  }
  return pairGroups;
};

const getValidChannels = (channels) => {
  // channel list guard
  if (!Array.isArray(channels)) {
    return [];
  }
  return Array.from(new Set(channels)).filter((channel) => {
    return ALERT_CHANNELS.includes(channel);
  });
};

const createFullDayRule = ({ channels, id, routeKey, terminalIds }) => {
  return {
    channels,
    daysOfWeek: EVERY_DAY_DAYS,
    endTime: FULL_DAY_END_TIME,
    id,
    routeKey,
    startTime: FULL_DAY_START_TIME,
    terminalIds,
  };
};

const getRouteRules = (alertSubscriptions) => {
  // route settings guard
  if (!alertSubscriptions || typeof alertSubscriptions !== "object") {
    return [];
  }
  return Object.entries(alertSubscriptions).flatMap(([routeKey, channels]) => {
    const validChannels = getValidChannels(channels);
    // empty channel guard
    if (validChannels.length === 0) {
      return [];
    }
    const terminalIds = routeKey.split(":");
    const normalizedRouteKey = getRouteKey(terminalIds);
    return [
      createFullDayRule({
        channels: validChannels,
        id: `route-alert:${normalizedRouteKey}`,
        routeKey: normalizedRouteKey,
        terminalIds,
      }),
    ];
  });
};

const getTerminalRules = (subscribedTerminals) => {
  // terminal settings guard
  if (!Array.isArray(subscribedTerminals)) {
    return [];
  }
  return subscribedTerminals.flatMap((terminalId) => {
    // terminal id guard
    if (typeof terminalId !== "string") {
      return [];
    }
    return getTerminalPairGroups(terminalId).map((terminalIds) => {
      const routeKey = getRouteKey(terminalIds);
      return createFullDayRule({
        channels: ALERT_CHANNELS,
        id: `terminal-alert:${terminalId}:${routeKey}`,
        routeKey,
        terminalIds: [terminalId],
      });
    });
  });
};

const getRuleSignature = (rule) => {
  return JSON.stringify({
    channels: [...rule.channels].sort(),
    date: rule.date ?? null,
    daysOfWeek: [...rule.daysOfWeek].sort(),
    endTime: rule.endTime,
    routeKey: rule.routeKey,
    startTime: rule.startTime,
    terminalIds: [...rule.terminalIds].sort(),
  });
};

const mergeRules = (rules) => {
  const byId = new Map();
  const signatures = new Set();
  rules.forEach((rule) => {
    const signature = getRuleSignature(rule);
    // duplicate guard
    if (signatures.has(signature)) {
      return;
    }
    signatures.add(signature);
    byId.set(rule.id, rule);
  });
  return Array.from(byId.values());
};

const getMigratedMetadata = (appMetadata) => {
  const nextMetadata = { ...(appMetadata ?? {}) };
  const alertRules = Array.isArray(nextMetadata.alertRules)
    ? nextMetadata.alertRules
    : [];
  nextMetadata.alertRules = mergeRules([
    ...alertRules,
    ...getRouteRules(nextMetadata.alertSubscriptions),
    ...getTerminalRules(nextMetadata.subscribedTerminals),
  ]);
  delete nextMetadata.alertSubscriptions;
  delete nextMetadata.subscribedTerminals;
  return nextMetadata;
};

module.exports = {
  // convert old alert settings
  up: async (queryInterface) => {
    const [rows] = await queryInterface.sequelize.query(`
      SELECT subject, "appMetadata"
      FROM "UserSettings"
      WHERE "appMetadata" ? 'alertSubscriptions'
         OR "appMetadata" ? 'subscribedTerminals'
    `);
    // settings rows
    for (const row of rows) {
      await queryInterface.bulkUpdate(
        "UserSettings",
        {
          appMetadata: getMigratedMetadata(row.appMetadata),
          updatedAt: new Date(),
        },
        { subject: row.subject }
      );
    }
  },

  // one-way metadata cleanup
  down: async () => {},
};
