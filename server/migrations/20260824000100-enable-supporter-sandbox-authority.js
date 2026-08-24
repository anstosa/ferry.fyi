"use strict";

const crypto = require("node:crypto");

const AUTHORITY_POLICY_ID = "supporter-runtime-v1";
const PROVIDER_PROJECT_KEY = "revenuecat-primary";
const SANDBOX_AUTHORITY = {
  environment: "sandbox",
  providerProjectKey: PROVIDER_PROJECT_KEY,
  runtimeAuthorized: true,
};

// hash one canonical authority set
const getAuthorityDigest = (authoritySet) =>
  crypto.createHash("sha256").update(JSON.stringify(authoritySet)).digest("hex");

// parse one stored authority set
const parseAuthoritySet = (value) => {
  // serialized value guard
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  // json collection guard
  if (Array.isArray(value)) {
    return value;
  }
  throw new Error("Supporter authority policy is invalid");
};

// compare one sandbox authority entry
const isSandboxAuthority = (entry) =>
  entry &&
  entry.environment === SANDBOX_AUTHORITY.environment &&
  entry.providerProjectKey === SANDBOX_AUTHORITY.providerProjectKey;

// update one locked authority policy
const updateAuthority = async (
  queryInterface,
  transaction,
  transform
) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT "authoritySet", "generation", "registryRevision"
       FROM "SupporterAuthorityPolicies"
      WHERE "id" = :id
      FOR UPDATE`,
    { replacements: { id: AUTHORITY_POLICY_ID }, transaction }
  );
  const policy = rows[0];
  // required policy guard
  if (!policy) {
    throw new Error("Supporter authority policy is unavailable");
  }
  const authoritySet = parseAuthoritySet(policy.authoritySet);
  const nextAuthoritySet = transform(authoritySet);
  // unchanged policy guard
  if (JSON.stringify(nextAuthoritySet) === JSON.stringify(authoritySet)) {
    return;
  }
  await queryInterface.bulkUpdate(
    "SupporterAuthorityPolicies",
    {
      authorityDigest: getAuthorityDigest(nextAuthoritySet),
      authoritySet: JSON.stringify(nextAuthoritySet),
      generation: (BigInt(policy.generation) + 1n).toString(),
      registryRevision: (BigInt(policy.registryRevision) + 1n).toString(),
      updatedAt: new Date(),
    },
    { id: AUTHORITY_POLICY_ID },
    { transaction }
  );
};

module.exports = {
  // admit sandbox authority behind its runtime gate
  up: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep authority mutation atomic
    try {
      await updateAuthority(queryInterface, transaction, (authoritySet) => {
        // existing sandbox authority guard
        if (authoritySet.some(isSandboxAuthority)) {
          return authoritySet;
        }
        return [...authoritySet, SANDBOX_AUTHORITY];
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // remove only the sandbox authority entry
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep authority rollback atomic
    try {
      await updateAuthority(queryInterface, transaction, (authoritySet) =>
        authoritySet.filter((entry) => !isSandboxAuthority(entry))
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
