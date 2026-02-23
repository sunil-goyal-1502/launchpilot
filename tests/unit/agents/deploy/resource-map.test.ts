import { describe, it, expect } from 'vitest';
import {
  getCheckpointForResource,
  buildResourceGroupCounts,
  mapTerraformOutputsToDeployResult,
  TerraformOutputs,
} from '../../../../src/agents/deploy/terraform/resource-map.js';

describe('getCheckpointForResource', () => {
  it('should map aws_vpc to Create VPC', () => {
    expect(getCheckpointForResource('aws_vpc')).toBe('Create VPC');
  });

  it('should map aws_subnet to Create VPC (grouped)', () => {
    expect(getCheckpointForResource('aws_subnet')).toBe('Create VPC');
  });

  it('should map aws_security_group to Configure Security Groups', () => {
    expect(getCheckpointForResource('aws_security_group')).toBe('Configure Security Groups');
  });

  it('should map aws_ecs_service to Launch Compute', () => {
    expect(getCheckpointForResource('aws_ecs_service')).toBe('Launch Compute');
  });

  it('should map aws_db_instance to Create RDS Instance', () => {
    expect(getCheckpointForResource('aws_db_instance')).toBe('Create RDS Instance');
  });

  it('should map aws_lb to Create ALB', () => {
    expect(getCheckpointForResource('aws_lb')).toBe('Create ALB');
  });

  it('should map aws_cloudfront_distribution to Configure CloudFront', () => {
    expect(getCheckpointForResource('aws_cloudfront_distribution')).toBe('Configure CloudFront');
  });

  it('should map aws_wafv2_web_acl to Deploy WAF', () => {
    expect(getCheckpointForResource('aws_wafv2_web_acl')).toBe('Deploy WAF');
  });

  it('should map aws_elasticache_replication_group to Create ElastiCache', () => {
    expect(getCheckpointForResource('aws_elasticache_replication_group')).toBe('Create ElastiCache');
  });

  it('should map aws_sqs_queue to Create SQS Queue', () => {
    expect(getCheckpointForResource('aws_sqs_queue')).toBe('Create SQS Queue');
  });

  it('should map aws_kinesis_stream to Create Streaming', () => {
    expect(getCheckpointForResource('aws_kinesis_stream')).toBe('Create Streaming');
  });

  it('should map aws_route53_zone to Configure DNS', () => {
    expect(getCheckpointForResource('aws_route53_zone')).toBe('Configure DNS');
  });

  it('should return undefined for unknown resource types', () => {
    expect(getCheckpointForResource('aws_s3_bucket')).toBeUndefined();
    expect(getCheckpointForResource('unknown')).toBeUndefined();
  });
});

describe('buildResourceGroupCounts', () => {
  it('should count resources per checkpoint group', () => {
    const types = ['aws_vpc', 'aws_subnet', 'aws_subnet', 'aws_internet_gateway', 'aws_security_group'];
    const counts = buildResourceGroupCounts(types);

    expect(counts.get('Create VPC')).toBe(4); // vpc + 2 subnets + igw
    expect(counts.get('Configure Security Groups')).toBe(1);
  });

  it('should ignore unmapped resource types', () => {
    const types = ['aws_vpc', 'aws_s3_bucket', 'custom_thing'];
    const counts = buildResourceGroupCounts(types);

    expect(counts.size).toBe(1);
    expect(counts.get('Create VPC')).toBe(1);
  });

  it('should return empty map for empty input', () => {
    const counts = buildResourceGroupCounts([]);
    expect(counts.size).toBe(0);
  });
});

describe('mapTerraformOutputsToDeployResult', () => {
  it('should extract app URL from outputs', () => {
    const outputs: TerraformOutputs = {
      app_url: { value: 'http://my-alb.us-east-1.elb.amazonaws.com', type: 'string' },
      dashboard_url: { value: 'https://console.aws.amazon.com/ecs/clusters/my-cluster', type: 'string' },
    };

    const result = mapTerraformOutputsToDeployResult(outputs);
    expect(result.url).toBe('http://my-alb.us-east-1.elb.amazonaws.com');
    expect(result.dashboardUrl).toContain('console.aws.amazon.com');
  });

  it('should fallback to alb_dns_name when app_url is missing', () => {
    const outputs: TerraformOutputs = {
      alb_dns_name: { value: 'my-alb.us-east-1.elb.amazonaws.com', type: 'string' },
    };

    const result = mapTerraformOutputsToDeployResult(outputs);
    expect(result.url).toBe('my-alb.us-east-1.elb.amazonaws.com');
  });

  it('should map resource outputs to DeployedResource array', () => {
    const outputs: TerraformOutputs = {
      vpc_id: { value: 'vpc-abc123', type: 'string' },
      ecs_cluster_arn: { value: 'arn:aws:ecs:us-east-1:123:cluster/app', type: 'string' },
      rds_endpoint: { value: 'db.xxx.us-east-1.rds.amazonaws.com:5432', type: 'string' },
      sqs_queue_url: { value: 'https://sqs.us-east-1.amazonaws.com/123/queue', type: 'string' },
    };

    const result = mapTerraformOutputsToDeployResult(outputs);
    expect(result.resources).toHaveLength(4);
    expect(result.resources.find(r => r.type === 'VPC')?.id).toBe('vpc-abc123');
    expect(result.resources.find(r => r.type === 'ECS Cluster')).toBeDefined();
    expect(result.resources.find(r => r.type === 'RDS Instance')).toBeDefined();
    expect(result.resources.find(r => r.type === 'SQS Queue')).toBeDefined();
  });

  it('should handle empty outputs', () => {
    const result = mapTerraformOutputsToDeployResult({});
    expect(result.url).toBe('');
    expect(result.dashboardUrl).toBe('');
    expect(result.resources).toHaveLength(0);
  });
});
