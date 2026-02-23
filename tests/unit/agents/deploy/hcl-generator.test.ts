import { describe, it, expect, afterEach } from 'vitest';
import { generateTerraformHCL } from '../../../../src/agents/deploy/terraform/hcl-generator.js';
import { ScalingStrategy, SecurityPolicy, CloudProvider } from '../../../../src/types/index.js';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Fixtures ──

function createFullStrategy(): ScalingStrategy {
  return {
    tier: 'medium',
    name: 'Production',
    description: '',
    provider: CloudProvider.AWS,
    compute: {
      instanceType: 't3.large',
      vCPUs: 2,
      memoryGB: 8,
      count: 2,
      autoScaling: true,
      minInstances: 2,
      maxInstances: 6,
    },
    database: {
      instanceType: 'db.t3.medium',
      engine: 'postgresql',
      storageGB: 100,
      multiAZ: true,
      readReplicas: 1,
    },
    network: {
      loadBalancer: true,
      loadBalancerType: 'ALB',
      cdn: true,
      cdnProvider: 'CloudFront',
      waf: true,
      natGateway: true,
      staticIP: true,
    },
    cache: {
      service: 'ElastiCache',
      engine: 'redis',
      nodeType: 'cache.t3.medium',
      nodes: 2,
      replication: true,
      memoryGB: 3,
    },
    queue: {
      service: 'SQS',
      type: 'SQS Standard',
      estimatedMessagesPerDay: 100000,
    },
    streaming: {
      service: 'Kinesis',
      type: 'Kinesis Data Streams',
      shards: 2,
      retentionHours: 24,
    },
    securityTier: 'standard',
    estimatedUsers: '1,000-50,000',
  };
}

function createMinimalStrategy(): ScalingStrategy {
  return {
    tier: 'low',
    name: 'Starter',
    description: '',
    provider: CloudProvider.AWS,
    compute: {
      instanceType: 't3.micro',
      vCPUs: 1,
      memoryGB: 1,
      count: 1,
      autoScaling: false,
    },
    network: {
      loadBalancer: false,
      cdn: false,
      waf: false,
      natGateway: false,
      staticIP: false,
    },
    securityTier: 'basic',
    estimatedUsers: '0-1,000',
  };
}

function createSecurity(): SecurityPolicy {
  return {
    tier: 'standard',
    waf: { enabled: true, rules: [], rateLimitRpm: 500 },
    network: {
      vpcEnabled: true,
      privateSubnets: true,
      publicSubnets: true,
      securityGroups: [],
      networkACLs: true,
      flowLogging: false,
    },
    tls: { minVersion: '1.2', hstsEnabled: true, hstsMaxAge: 31536000, certProvider: 'ACM' },
    iam: { leastPrivilege: true, serviceRoles: [], mfaRequired: false },
    secrets: { provider: 'Secrets Manager', envVarsToSecrets: {}, rotationEnabled: true, rotationDays: 90 },
    vulnerabilities: [],
  };
}

// ── Tests ──

const testDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `launchpilot-hcl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  testDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of testDirs) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  testDirs.length = 0;
});

describe('generateTerraformHCL', () => {
  it('should generate all expected files for full strategy', () => {
    const dir = makeTempDir();
    const result = generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    expect(result.files).toContain('main.tf');
    expect(result.files).toContain('variables.tf');
    expect(result.files).toContain('vpc.tf');
    expect(result.files).toContain('security.tf');
    expect(result.files).toContain('compute.tf');
    expect(result.files).toContain('database.tf');
    expect(result.files).toContain('loadbalancer.tf');
    expect(result.files).toContain('cdn.tf');
    expect(result.files).toContain('waf.tf');
    expect(result.files).toContain('cache.tf');
    expect(result.files).toContain('queue.tf');
    expect(result.files).toContain('streaming.tf');
    expect(result.files).toContain('dns.tf');
    expect(result.files).toContain('outputs.tf');
    expect(result.files).toContain('terraform.tfvars');
  });

  it('should generate only core files for minimal strategy', () => {
    const dir = makeTempDir();
    const result = generateTerraformHCL(createMinimalStrategy(), createSecurity(), 'test-app', dir);

    expect(result.files).toContain('main.tf');
    expect(result.files).toContain('vpc.tf');
    expect(result.files).toContain('compute.tf');
    expect(result.files).not.toContain('database.tf');
    expect(result.files).not.toContain('loadbalancer.tf');
    expect(result.files).not.toContain('cdn.tf');
    expect(result.files).not.toContain('waf.tf');
    expect(result.files).not.toContain('cache.tf');
    expect(result.files).not.toContain('queue.tf');
    expect(result.files).not.toContain('streaming.tf');
  });

  it('should write actual files to disk', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    expect(existsSync(join(dir, 'main.tf'))).toBe(true);
    expect(existsSync(join(dir, 'vpc.tf'))).toBe(true);
    expect(existsSync(join(dir, 'compute.tf'))).toBe(true);
    expect(existsSync(join(dir, 'database.tf'))).toBe(true);
  });

  it('should contain correct AWS provider configuration in main.tf', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const mainTf = readFileSync(join(dir, 'main.tf'), 'utf-8');
    expect(mainTf).toContain('hashicorp/aws');
    expect(mainTf).toContain('var.region');
    expect(mainTf).toContain('ManagedBy');
    expect(mainTf).toContain('launchpilot');
  });

  it('should contain VPC with public and private subnets', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const vpcTf = readFileSync(join(dir, 'vpc.tf'), 'utf-8');
    expect(vpcTf).toContain('aws_vpc');
    expect(vpcTf).toContain('aws_subnet');
    expect(vpcTf).toContain('aws_internet_gateway');
    expect(vpcTf).toContain('aws_nat_gateway');
    expect(vpcTf).toContain('10.0.0.0/16');
  });

  it('should generate ECS Fargate with correct CPU/memory for t3.large', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const computeTf = readFileSync(join(dir, 'compute.tf'), 'utf-8');
    expect(computeTf).toContain('aws_ecs_cluster');
    expect(computeTf).toContain('aws_ecs_task_definition');
    expect(computeTf).toContain('aws_ecs_service');
    expect(computeTf).toContain('cpu                      = 2048');
    expect(computeTf).toContain('memory                   = 4096');
    expect(computeTf).toContain('desired_count   = 2');
    expect(computeTf).toContain('FARGATE');
  });

  it('should include auto-scaling when enabled', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const computeTf = readFileSync(join(dir, 'compute.tf'), 'utf-8');
    expect(computeTf).toContain('aws_appautoscaling_target');
    expect(computeTf).toContain('aws_appautoscaling_policy');
    expect(computeTf).toContain('max_capacity       = 6');
    expect(computeTf).toContain('min_capacity       = 2');
  });

  it('should NOT include auto-scaling when disabled', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createMinimalStrategy(), createSecurity(), 'test-app', dir);

    const computeTf = readFileSync(join(dir, 'compute.tf'), 'utf-8');
    expect(computeTf).not.toContain('aws_appautoscaling_target');
  });

  it('should generate RDS with correct engine and instance type', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const dbTf = readFileSync(join(dir, 'database.tf'), 'utf-8');
    expect(dbTf).toContain('aws_db_instance');
    expect(dbTf).toContain('engine               = "postgres"');
    expect(dbTf).toContain('instance_class       = "db.t3.medium"');
    expect(dbTf).toContain('allocated_storage    = 100');
    expect(dbTf).toContain('multi_az             = true');
    expect(dbTf).toContain('storage_encrypted    = true');
  });

  it('should generate read replicas', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const dbTf = readFileSync(join(dir, 'database.tf'), 'utf-8');
    expect(dbTf).toContain('aws_db_instance" "replica_0"');
    expect(dbTf).toContain('replicate_source_db');
  });

  it('should generate ALB with target group and listener', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const lbTf = readFileSync(join(dir, 'loadbalancer.tf'), 'utf-8');
    expect(lbTf).toContain('aws_lb');
    expect(lbTf).toContain('aws_lb_target_group');
    expect(lbTf).toContain('aws_lb_listener');
    expect(lbTf).toContain('/health');
  });

  it('should generate WAF with rate limiting and managed rules', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const wafTf = readFileSync(join(dir, 'waf.tf'), 'utf-8');
    expect(wafTf).toContain('aws_wafv2_web_acl');
    expect(wafTf).toContain('rate_based_statement');
    expect(wafTf).toContain('AWSManagedRulesCommonRuleSet');
    expect(wafTf).toContain('AWSManagedRulesSQLiRuleSet');
  });

  it('should generate security groups with correct port for PostgreSQL', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const secTf = readFileSync(join(dir, 'security.tf'), 'utf-8');
    expect(secTf).toContain('aws_security_group');
    expect(secTf).toContain('5432'); // PostgreSQL port
    expect(secTf).toContain('443'); // HTTPS
  });

  it('should generate cache with redis configuration', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const cacheTf = readFileSync(join(dir, 'cache.tf'), 'utf-8');
    expect(cacheTf).toContain('aws_elasticache_replication_group');
    expect(cacheTf).toContain('cache.t3.medium');
    expect(cacheTf).toContain('num_cache_clusters   = 2');
    expect(cacheTf).toContain('engine               = "redis"');
  });

  it('should generate SQS queue', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const queueTf = readFileSync(join(dir, 'queue.tf'), 'utf-8');
    expect(queueTf).toContain('aws_sqs_queue');
  });

  it('should generate Kinesis stream with correct shard count', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const streamTf = readFileSync(join(dir, 'streaming.tf'), 'utf-8');
    expect(streamTf).toContain('aws_kinesis_stream');
    expect(streamTf).toContain('shard_count      = 2');
    expect(streamTf).toContain('retention_period = 24');
  });

  it('should generate outputs for all resources', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);

    const outputsTf = readFileSync(join(dir, 'outputs.tf'), 'utf-8');
    expect(outputsTf).toContain('vpc_id');
    expect(outputsTf).toContain('ecs_cluster_arn');
    expect(outputsTf).toContain('alb_dns_name');
    expect(outputsTf).toContain('rds_endpoint');
    expect(outputsTf).toContain('cloudfront_distribution_id');
    expect(outputsTf).toContain('waf_acl_id');
    expect(outputsTf).toContain('elasticache_endpoint');
    expect(outputsTf).toContain('sqs_queue_url');
    expect(outputsTf).toContain('kinesis_stream_arn');
    expect(outputsTf).toContain('route53_zone_id');
  });

  it('should return correct resource count', () => {
    const dir = makeTempDir();
    const result = generateTerraformHCL(createFullStrategy(), createSecurity(), 'test-app', dir);
    // VPC(9) + SG(3) + Compute(5) + DB(3) + ALB(3) + CDN(1) + WAF(2) + Cache(2) + Queue(1) + Streaming(1) + DNS(2)
    expect(result.resourceCount).toBeGreaterThan(20);
  });

  it('should sanitize project name for HCL', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createMinimalStrategy(), createSecurity(), 'My App!! (v2)', dir);

    const tfvars = readFileSync(join(dir, 'terraform.tfvars'), 'utf-8');
    expect(tfvars).toContain('my-app----v2-');
    expect(tfvars).not.toContain('!');
    expect(tfvars).not.toContain('(');
  });

  it('should use custom region when provided', () => {
    const dir = makeTempDir();
    generateTerraformHCL(createMinimalStrategy(), createSecurity(), 'test-app', dir, { region: 'eu-west-1' });

    const tfvars = readFileSync(join(dir, 'terraform.tfvars'), 'utf-8');
    expect(tfvars).toContain('eu-west-1');
  });

  it('should create output directory if it does not exist', () => {
    const dir = join(makeTempDir(), 'nested', 'dir');
    const result = generateTerraformHCL(createMinimalStrategy(), createSecurity(), 'test-app', dir);

    expect(existsSync(dir)).toBe(true);
    expect(result.files.length).toBeGreaterThan(0);
  });
});
