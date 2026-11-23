#!/usr/bin/env bash
# Deploys a server image to ECS:
#   1. registers new revisions of the api/worker/migrate task definitions with the new image
#      (everything else is copied from the latest revision, which Terraform owns)
#   2. runs the migrate task and fails the deploy if migrations fail
#   3. rolls the api and worker services onto the new revisions and waits until stable
#      (the deployment circuit breaker rolls back automatically if new tasks keep failing)
#
# Usage: IMAGE=<repo>:<tag> scripts/deploy-ecs.sh
# Required env: IMAGE ECS_CLUSTER ECS_CAPACITY_PROVIDER ECS_API_FAMILY ECS_WORKER_FAMILY ECS_MIGRATE_FAMILY
set -euo pipefail

: "${IMAGE:?}" "${ECS_CLUSTER:?}" "${ECS_CAPACITY_PROVIDER:?}"
: "${ECS_API_FAMILY:?}" "${ECS_WORKER_FAMILY:?}" "${ECS_MIGRATE_FAMILY:?}"

register_with_image() {
  local family="$1"
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json \
    | jq --arg image "$IMAGE" '
        .containerDefinitions[0].image = $image
        | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
              .registeredAt, .registeredBy, .deregisteredAt)' \
    > "/tmp/taskdef-$family.json"
  aws ecs register-task-definition --cli-input-json "file:///tmp/taskdef-$family.json" \
    --query taskDefinition.taskDefinitionArn --output text
}

echo "::group::Register task definitions for $IMAGE"
api_td=$(register_with_image "$ECS_API_FAMILY")
worker_td=$(register_with_image "$ECS_WORKER_FAMILY")
migrate_td=$(register_with_image "$ECS_MIGRATE_FAMILY")
echo "api:     $api_td"
echo "worker:  $worker_td"
echo "migrate: $migrate_td"
echo "::endgroup::"

echo "::group::Run database migrations"
task_arn=$(aws ecs run-task \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$migrate_td" \
  --capacity-provider-strategy "capacityProvider=$ECS_CAPACITY_PROVIDER,weight=1" \
  --started-by "github-deploy" \
  --query 'tasks[0].taskArn' --output text)
if [[ -z "$task_arn" || "$task_arn" == "None" ]]; then
  echo "::error::Could not start the migration task (no capacity?)"
  exit 1
fi
echo "Migration task: $task_arn"
aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER" --tasks "$task_arn"
exit_code=$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
  --query 'tasks[0].containers[0].exitCode' --output text)
if [[ "$exit_code" != "0" ]]; then
  reason=$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].stoppedReason' --output text)
  echo "::error::Migrations failed (exit code $exit_code): $reason. Check the /ecs/*/migrate log group."
  exit 1
fi
echo "Migrations applied."
echo "::endgroup::"

echo "::group::Roll out services"
aws ecs update-service --cluster "$ECS_CLUSTER" --service api --task-definition "$api_td" >/dev/null
aws ecs update-service --cluster "$ECS_CLUSTER" --service worker --task-definition "$worker_td" >/dev/null
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services api worker
echo "::endgroup::"

# The circuit breaker may have rolled back; make sure the new revision is what's running.
running=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services api \
  --query 'services[0].taskDefinition' --output text)
if [[ "$running" != "$api_td" ]]; then
  echo "::error::API rolled back to $running. New tasks failed health checks; see the /ecs/*/api log group."
  exit 1
fi
echo "Deployed $IMAGE"
