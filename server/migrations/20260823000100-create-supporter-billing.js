"use strict";

const crypto = require("node:crypto");

const AUTHORITY_POLICY_ID = "supporter-runtime-v1";
const PROVIDER_PROJECT_KEY = "revenuecat-primary";

// build the initial production authority
const getInitialAuthority = () => [
  {
    environment: "production",
    providerProjectKey: PROVIDER_PROJECT_KEY,
    runtimeAuthorized: true,
  },
];

// hash the canonical authority set
const getAuthorityDigest = (authoritySet) =>
  crypto.createHash("sha256").update(JSON.stringify(authoritySet)).digest("hex");

module.exports = {
  // create the supporter billing boundary
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep schema creation atomic
    try {
      await queryInterface.createTable(
        "SupporterCustomers",
        {
          id: {
            allowNull: false,
            defaultValue: Sequelize.literal("gen_random_uuid()"),
            primaryKey: true,
            type: Sequelize.UUID,
          },
          subject: { allowNull: true, type: Sequelize.STRING, unique: true },
          detachedAt: { allowNull: true, type: Sequelize.DATE },
          runtimeProjectionGeneration: {
            allowNull: false,
            defaultValue: 0,
            type: Sequelize.BIGINT,
          },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.createTable(
        "SupporterSubscriptions",
        {
          providerProjectKey: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(64),
          },
          providerSubscriptionId: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(512),
          },
          customerId: {
            allowNull: false,
            type: Sequelize.UUID,
            references: { key: "id", model: "SupporterCustomers" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
          store: { allowNull: false, type: Sequelize.STRING(32) },
          productIdentifier: { allowNull: false, type: Sequelize.STRING(256) },
          planInterval: { allowNull: false, type: Sequelize.STRING(16) },
          environment: { allowNull: false, type: Sequelize.STRING(16) },
          lifecycleState: { allowNull: false, type: Sequelize.STRING(32) },
          willRenew: { allowNull: false, defaultValue: false, type: Sequelize.BOOLEAN },
          startsAt: { allowNull: true, type: Sequelize.DATE },
          currentPeriodEndsAt: { allowNull: true, type: Sequelize.DATE },
          billingIssueAt: { allowNull: true, type: Sequelize.DATE },
          refundedAt: { allowNull: true, type: Sequelize.DATE },
          revokedAt: { allowNull: true, type: Sequelize.DATE },
          providerUpdatedAt: { allowNull: true, type: Sequelize.DATE },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.createTable(
        "SupporterEntitlements",
        {
          customerId: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.UUID,
            references: { key: "id", model: "SupporterCustomers" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
          providerProjectKey: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(64),
          },
          environment: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(16),
          },
          entitlementIdentifier: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(128),
          },
          accessState: { allowNull: false, type: Sequelize.STRING(16) },
          lifecycleState: { allowNull: false, type: Sequelize.STRING(32) },
          activeUntil: { allowNull: true, type: Sequelize.DATE },
          lastProviderEventAt: { allowNull: true, type: Sequelize.DATE },
          lastVerifiedAt: { allowNull: false, type: Sequelize.DATE },
          lastReconciledAt: { allowNull: false, type: Sequelize.DATE },
          sourceCount: { allowNull: false, defaultValue: 0, type: Sequelize.INTEGER },
          primaryStore: { allowNull: true, type: Sequelize.STRING(32) },
          reconcileGeneration: {
            allowNull: false,
            defaultValue: 0,
            type: Sequelize.BIGINT,
          },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.createTable(
        "RevenueCatWebhookEvents",
        {
          providerProjectKey: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(64),
          },
          eventId: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(256),
          },
          eventType: { allowNull: false, type: Sequelize.STRING(64) },
          eventTimestamp: { allowNull: false, type: Sequelize.DATE },
          environment: { allowNull: false, type: Sequelize.STRING(16) },
          appId: { allowNull: true, type: Sequelize.STRING(128) },
          bodyHash: { allowNull: false, type: Sequelize.STRING(64) },
          status: { allowNull: false, defaultValue: "pending", type: Sequelize.STRING(16) },
          attemptCount: { allowNull: false, defaultValue: 0, type: Sequelize.INTEGER },
          nextAttemptAt: { allowNull: false, type: Sequelize.DATE },
          processedAt: { allowNull: true, type: Sequelize.DATE },
          errorCode: { allowNull: true, type: Sequelize.STRING(64) },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.createTable(
        "RevenueCatWebhookEventTargets",
        {
          providerProjectKey: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(64),
          },
          eventId: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(256),
          },
          customerId: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.UUID,
            references: { key: "id", model: "SupporterCustomers" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
          environment: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(16),
          },
          requiredGeneration: { allowNull: false, type: Sequelize.BIGINT },
          status: { allowNull: false, defaultValue: "pending", type: Sequelize.STRING(16) },
          completedAt: { allowNull: true, type: Sequelize.DATE },
          errorCode: { allowNull: true, type: Sequelize.STRING(64) },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.createTable(
        "SupporterReconcileWorks",
        {
          customerId: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.UUID,
            references: { key: "id", model: "SupporterCustomers" },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
          providerProjectKey: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(64),
          },
          environment: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(16),
          },
          requestedGeneration: { allowNull: false, defaultValue: 0, type: Sequelize.BIGINT },
          claimedGeneration: { allowNull: false, defaultValue: 0, type: Sequelize.BIGINT },
          completedGeneration: { allowNull: false, defaultValue: 0, type: Sequelize.BIGINT },
          state: { allowNull: false, defaultValue: "idle", type: Sequelize.STRING(16) },
          leaseToken: { allowNull: true, type: Sequelize.UUID },
          leaseExpiresAt: { allowNull: true, type: Sequelize.DATE },
          requestedAt: { allowNull: true, type: Sequelize.DATE },
          startedAt: { allowNull: true, type: Sequelize.DATE },
          completedAt: { allowNull: true, type: Sequelize.DATE },
          nextAttemptAt: { allowNull: false, type: Sequelize.DATE },
          attemptCount: { allowNull: false, defaultValue: 0, type: Sequelize.INTEGER },
          errorCode: { allowNull: true, type: Sequelize.STRING(64) },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.createTable(
        "SupporterAuthorityPolicies",
        {
          id: { allowNull: false, primaryKey: true, type: Sequelize.STRING(64) },
          generation: { allowNull: false, defaultValue: 1, type: Sequelize.BIGINT },
          registryRevision: { allowNull: false, defaultValue: 1, type: Sequelize.BIGINT },
          authoritySet: { allowNull: false, type: Sequelize.JSONB },
          authorityDigest: { allowNull: false, type: Sequelize.STRING(64) },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.createTable(
        "ProviderActionWindows",
        {
          action: { allowNull: false, primaryKey: true, type: Sequelize.STRING(64) },
          principalKind: { allowNull: false, primaryKey: true, type: Sequelize.STRING(16) },
          principalKey: { allowNull: false, primaryKey: true, type: Sequelize.STRING(80) },
          fixedWindowStart: { allowNull: false, primaryKey: true, type: Sequelize.DATE },
          count: { allowNull: false, defaultValue: 0, type: Sequelize.INTEGER },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.addColumn(
        "LeaderboardProfiles",
        "supporterBadgeVisible",
        { allowNull: false, defaultValue: false, type: Sequelize.BOOLEAN },
        { transaction }
      );

      await queryInterface.addIndex(
        "SupporterSubscriptions",
        ["customerId", "providerProjectKey", "environment", "lifecycleState"],
        { name: "supporter_subscriptions_runtime", transaction }
      );
      await queryInterface.addIndex(
        "SupporterEntitlements",
        ["accessState", "activeUntil"],
        { name: "supporter_entitlements_expiry", transaction }
      );
      await queryInterface.addIndex(
        "RevenueCatWebhookEvents",
        ["status", "nextAttemptAt"],
        { name: "revenuecat_webhook_events_claimable", transaction }
      );
      await queryInterface.addIndex(
        "SupporterReconcileWorks",
        ["state", "nextAttemptAt", "leaseExpiresAt"],
        { name: "supporter_reconcile_works_claimable", transaction }
      );
      await queryInterface.addIndex(
        "ProviderActionWindows",
        ["fixedWindowStart"],
        { name: "provider_action_windows_cleanup", transaction }
      );

      await queryInterface.sequelize.query(
        `
        ALTER TABLE "SupporterCustomers"
          ADD CONSTRAINT supporter_customer_generation CHECK ("runtimeProjectionGeneration" >= 0),
          ADD CONSTRAINT supporter_customer_detachment CHECK (
            ("subject" IS NOT NULL AND "detachedAt" IS NULL) OR
            ("subject" IS NULL AND "detachedAt" IS NOT NULL)
          );
        ALTER TABLE "SupporterSubscriptions"
          ADD CONSTRAINT supporter_subscription_store CHECK ("store" IN ('app_store', 'play_store', 'rc_billing', 'unknown')),
          ADD CONSTRAINT supporter_subscription_interval CHECK ("planInterval" IN ('month', 'year', 'unknown')),
          ADD CONSTRAINT supporter_subscription_environment CHECK ("environment" IN ('production', 'sandbox'));
        ALTER TABLE "SupporterEntitlements"
          ADD CONSTRAINT supporter_entitlement_access CHECK ("accessState" IN ('active', 'inactive')),
          ADD CONSTRAINT supporter_entitlement_environment CHECK ("environment" IN ('production', 'sandbox')),
          ADD CONSTRAINT supporter_entitlement_source_count CHECK ("sourceCount" >= 0),
          ADD CONSTRAINT supporter_entitlement_generation CHECK ("reconcileGeneration" >= 0);
        ALTER TABLE "RevenueCatWebhookEvents"
          ADD CONSTRAINT revenuecat_webhook_body_hash CHECK ("bodyHash" ~ '^[0-9a-f]{64}$'),
          ADD CONSTRAINT revenuecat_webhook_environment CHECK ("environment" IN ('production', 'sandbox')),
          ADD CONSTRAINT revenuecat_webhook_status CHECK ("status" IN ('pending', 'processing', 'succeeded', 'failed'));
        ALTER TABLE "RevenueCatWebhookEventTargets"
          ADD CONSTRAINT revenuecat_webhook_target_environment CHECK ("environment" IN ('production', 'sandbox')),
          ADD CONSTRAINT revenuecat_webhook_target_status CHECK ("status" IN ('pending', 'processing', 'succeeded', 'failed'));
        ALTER TABLE "SupporterReconcileWorks"
          ADD CONSTRAINT supporter_reconcile_environment CHECK ("environment" IN ('production', 'sandbox')),
          ADD CONSTRAINT supporter_reconcile_state CHECK ("state" IN ('idle', 'pending', 'running', 'failed')),
          ADD CONSTRAINT supporter_reconcile_generations CHECK (
            "requestedGeneration" >= 0 AND
            "claimedGeneration" >= 0 AND
            "completedGeneration" >= 0 AND
            "completedGeneration" <= "claimedGeneration" AND
            "claimedGeneration" <= "requestedGeneration"
          );
        ALTER TABLE "SupporterAuthorityPolicies"
          ADD CONSTRAINT supporter_authority_generation CHECK ("generation" >= 1),
          ADD CONSTRAINT supporter_authority_revision CHECK ("registryRevision" >= 0),
          ADD CONSTRAINT supporter_authority_digest CHECK ("authorityDigest" ~ '^[0-9a-f]{64}$');
        ALTER TABLE "ProviderActionWindows"
          ADD CONSTRAINT provider_action_kind CHECK ("principalKind" IN ('account', 'ip')),
          ADD CONSTRAINT provider_action_count CHECK ("count" >= 0 AND "count" <= 20);

        CREATE OR REPLACE FUNCTION prevent_supporter_customer_reattachment()
        RETURNS trigger AS $$
        BEGIN
          IF OLD."subject" IS NULL AND NEW."subject" IS NOT NULL THEN
            RAISE EXCEPTION 'detached supporter customers cannot be reattached';
          END IF;
          IF OLD."subject" IS NOT NULL AND NEW."subject" IS NOT NULL AND OLD."subject" <> NEW."subject" THEN
            RAISE EXCEPTION 'supporter customer ownership is immutable';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER supporter_customer_identity_immutable
          BEFORE UPDATE ON "SupporterCustomers"
          FOR EACH ROW EXECUTE FUNCTION prevent_supporter_customer_reattachment();
      `,
        { transaction }
      );

      const authoritySet = getInitialAuthority();
      const now = new Date();
      await queryInterface.bulkInsert(
        "SupporterAuthorityPolicies",
        [
          {
            id: AUTHORITY_POLICY_ID,
            generation: 1,
            registryRevision: 1,
            authoritySet: JSON.stringify(authoritySet),
            authorityDigest: getAuthorityDigest(authoritySet),
            createdAt: now,
            updatedAt: now,
          },
        ],
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial billing state
      await transaction.rollback();
      throw error;
    }
  },

  // remove only supporter billing state
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep schema rollback atomic
    try {
      await queryInterface.removeColumn(
        "LeaderboardProfiles",
        "supporterBadgeVisible",
        { transaction }
      );
      await queryInterface.dropTable("ProviderActionWindows", { transaction });
      await queryInterface.dropTable("RevenueCatWebhookEventTargets", { transaction });
      await queryInterface.dropTable("RevenueCatWebhookEvents", { transaction });
      await queryInterface.dropTable("SupporterEntitlements", { transaction });
      await queryInterface.dropTable("SupporterSubscriptions", { transaction });
      await queryInterface.dropTable("SupporterReconcileWorks", { transaction });
      await queryInterface.dropTable("SupporterAuthorityPolicies", { transaction });
      await queryInterface.dropTable("SupporterCustomers", { transaction });
      await queryInterface.sequelize.query(
        "DROP FUNCTION IF EXISTS prevent_supporter_customer_reattachment();",
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial billing cleanup
      await transaction.rollback();
      throw error;
    }
  },
};
