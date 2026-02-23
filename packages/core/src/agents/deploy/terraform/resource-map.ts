/**
 * Maps Terraform resource types to checkpoint names used by the deploy pipeline.
 * This ensures the progress bar and checkpoint callbacks work identically
 * whether running in simulation or live Terraform mode.
 */

import { DeployResult, DeployedResource } from '../../../types/index';

// ── Terraform resource type → checkpoint name ──

const TF_RESOURCE_TO_CHECKPOINT: Record<string, string> = {
  'aws_vpc': 'Create VPC',
  'aws_subnet': 'Create VPC',
  'aws_internet_gateway': 'Create VPC',
  'aws_nat_gateway': 'Create VPC',
  'aws_route_table': 'Create VPC',
  'aws_route_table_association': 'Create VPC',
  'aws_eip': 'Create VPC',

  'aws_security_group': 'Configure Security Groups',
  'aws_security_group_rule': 'Configure Security Groups',

  'aws_ecs_cluster': 'Launch Compute',
  'aws_ecs_service': 'Launch Compute',
  'aws_ecs_task_definition': 'Launch Compute',
  'aws_appautoscaling_target': 'Launch Compute',
  'aws_appautoscaling_policy': 'Launch Compute',
  'aws_iam_role': 'Launch Compute',
  'aws_iam_role_policy_attachment': 'Launch Compute',
  'aws_cloudwatch_log_group': 'Launch Compute',

  'aws_db_instance': 'Create RDS Instance',
  'aws_db_subnet_group': 'Create RDS Instance',
  'aws_db_parameter_group': 'Create RDS Instance',

  'aws_lb': 'Create ALB',
  'aws_lb_target_group': 'Create ALB',
  'aws_lb_listener': 'Create ALB',

  'aws_cloudfront_distribution': 'Configure CloudFront',
  'aws_cloudfront_origin_access_identity': 'Configure CloudFront',

  'aws_wafv2_web_acl': 'Deploy WAF',
  'aws_wafv2_web_acl_association': 'Deploy WAF',

  'aws_elasticache_replication_group': 'Create ElastiCache',
  'aws_elasticache_subnet_group': 'Create ElastiCache',
  'aws_elasticache_parameter_group': 'Create ElastiCache',

  'aws_sqs_queue': 'Create SQS Queue',

  'aws_kinesis_stream': 'Create Streaming',

  'aws_route53_zone': 'Configure DNS',
  'aws_route53_record': 'Configure DNS',
};

/**
 * Given a Terraform resource type (e.g. "aws_vpc"), return the matching
 * checkpoint name (e.g. "Create VPC"), or undefined if unmapped.
 */
export function getCheckpointForResource(tfResourceType: string): string | undefined {
  return TF_RESOURCE_TO_CHECKPOINT[tfResourceType];
}

/**
 * Count how many distinct TF resources map to each checkpoint.
 * Used to know when a checkpoint group is "fully applied".
 */
export function buildResourceGroupCounts(tfResourceTypes: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rt of tfResourceTypes) {
    const checkpoint = TF_RESOURCE_TO_CHECKPOINT[rt];
    if (checkpoint) {
      counts.set(checkpoint, (counts.get(checkpoint) ?? 0) + 1);
    }
  }
  return counts;
}

// ── Terraform output → DeployResult mapping ──

export interface TerraformOutputs {
  [key: string]: { value: string | number | boolean | Record<string, unknown>; type: string };
}

/**
 * Extracts real URLs, IDs, and resources from `terraform output -json` to
 * populate a DeployResult with actual infrastructure references.
 */
export function mapTerraformOutputsToDeployResult(
  outputs: TerraformOutputs,
): { url: string; dashboardUrl: string; resources: DeployedResource[] } {
  const url = String(outputs['app_url']?.value ?? outputs['alb_dns_name']?.value ?? '');
  const dashboardUrl = String(outputs['dashboard_url']?.value ?? '');

  const resources: DeployedResource[] = [];

  const resourceOutputMappings: Array<{ outputKey: string; type: string; name: string }> = [
    { outputKey: 'vpc_id', type: 'VPC', name: 'launchpilot-vpc' },
    { outputKey: 'ecs_cluster_arn', type: 'ECS Cluster', name: 'launchpilot-cluster' },
    { outputKey: 'ecs_service_name', type: 'ECS Service', name: 'launchpilot-service' },
    { outputKey: 'rds_endpoint', type: 'RDS Instance', name: 'launchpilot-db' },
    { outputKey: 'alb_arn', type: 'ALB', name: 'launchpilot-alb' },
    { outputKey: 'cloudfront_distribution_id', type: 'CloudFront', name: 'launchpilot-cdn' },
    { outputKey: 'waf_acl_id', type: 'WAF', name: 'launchpilot-waf' },
    { outputKey: 'elasticache_endpoint', type: 'ElastiCache', name: 'launchpilot-cache' },
    { outputKey: 'sqs_queue_url', type: 'SQS Queue', name: 'launchpilot-queue' },
    { outputKey: 'kinesis_stream_arn', type: 'Kinesis Stream', name: 'launchpilot-stream' },
    { outputKey: 'route53_zone_id', type: 'Route53 Zone', name: 'launchpilot-dns' },
  ];

  for (const mapping of resourceOutputMappings) {
    const val = outputs[mapping.outputKey]?.value;
    if (val !== undefined && val !== '') {
      resources.push({
        type: mapping.type,
        name: mapping.name,
        id: String(val),
        status: 'active',
      });
    }
  }

  return { url, dashboardUrl, resources };
}
