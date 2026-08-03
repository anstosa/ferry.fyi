import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const terraform = readFileSync("infra/aws/terraform/main.tf", "utf8");
const deployWorkflow = readFileSync(".github/workflows/deploy-aws.yml", "utf8");

describe("AWS scheduler ownership", () => {
  it("runs recurring jobs in the singleton web task", () => {
    expect(terraform).toMatch(
      /\{ name = "PROCESS_ROLE", value = "web" \},\s*\{ name = "RUN_SCHEDULER", value = "true" \}/
    );
    expect(terraform).not.toContain('resource "aws_ecs_service" "scheduler"');
    expect(terraform).not.toContain(
      'resource "aws_ecs_task_definition" "scheduler"'
    );
  });

  it("deploys only the combined web service", () => {
    expect(deployWorkflow).not.toContain("ECS_SCHEDULER_SERVICE");
    expect(deployWorkflow).not.toContain(
      "ECS_SCHEDULER_TASK_DEFINITION_FAMILY"
    );
    expect(deployWorkflow).not.toContain("container-name: scheduler");
  });
});
