/**
 * Converts a ScalingStrategy + SecurityPolicy into Terraform HCL files.
 * Each resource type has a dedicated generator function that produces
 * idiomatic .tf content. Files are written to the specified output directory.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ScalingStrategy, SecurityPolicy } from '../../../types/index.js';

export interface TerraformGenerationResult {
  outputDir: string;
  files: string[];
  resourceCount: number;
}

export interface HCLGeneratorOptions {
  region?: string;
}

// ── Fargate CPU/memory mapping from EC2 instance types ──

interface FargateSize {
  cpu: number;
  memory: number;
}

function mapInstanceToFargate(instanceType: string): FargateSize {
  // Map common EC2 instance types to Fargate CPU/memory
  const mappings: Record<string, FargateSize> = {
    't3.micro': { cpu: 256, memory: 512 },
    't3.small': { cpu: 512, memory: 1024 },
    't3.medium': { cpu: 1024, memory: 2048 },
    't3.large': { cpu: 2048, memory: 4096 },
    't3.xlarge': { cpu: 4096, memory: 8192 },
    'm5.large': { cpu: 2048, memory: 4096 },
    'm5.xlarge': { cpu: 4096, memory: 8192 },
    'c5.large': { cpu: 2048, memory: 4096 },
    'c5.xlarge': { cpu: 4096, memory: 8192 },
  };
  return mappings[instanceType] ?? { cpu: 1024, memory: 2048 };
}

// ── Main generator ──

export function generateTerraformHCL(
  strategy: ScalingStrategy,
  security: SecurityPolicy,
  repoName: string,
  outputDir: string,
  options?: HCLGeneratorOptions,
): TerraformGenerationResult {
  const region = options?.region ?? 'us-east-1';
  const projectName = repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 24);
  const files: string[] = [];
  let resourceCount = 0;

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // main.tf — provider + terraform settings
  const mainTf = generateMainHCL(region);
  writeFile(outputDir, 'main.tf', mainTf);
  files.push('main.tf');

  // variables.tf
  const variablesTf = generateVariablesHCL(projectName, region);
  writeFile(outputDir, 'variables.tf', variablesTf);
  files.push('variables.tf');

  // vpc.tf — always created
  const vpcTf = generateVpcHCL();
  writeFile(outputDir, 'vpc.tf', vpcTf);
  files.push('vpc.tf');
  resourceCount += 9; // VPC + 2 public subnets + 2 private subnets + IGW + NAT + EIP + route tables

  // security.tf — always created
  const securityTf = generateSecurityHCL(security, strategy);
  writeFile(outputDir, 'security.tf', securityTf);
  files.push('security.tf');
  resourceCount += 3; // web SG + app SG + db SG

  // compute.tf — always created (ECS Fargate)
  const computeTf = generateComputeHCL(strategy, projectName);
  writeFile(outputDir, 'compute.tf', computeTf);
  files.push('compute.tf');
  resourceCount += 5; // cluster + task def + service + IAM roles + log group

  // database.tf — conditional
  if (strategy.database) {
    const databaseTf = generateDatabaseHCL(strategy);
    writeFile(outputDir, 'database.tf', databaseTf);
    files.push('database.tf');
    resourceCount += 2 + strategy.database.readReplicas; // instance + subnet group + replicas
  }

  // loadbalancer.tf — conditional
  if (strategy.network.loadBalancer) {
    const lbTf = generateLoadBalancerHCL(strategy, security);
    writeFile(outputDir, 'loadbalancer.tf', lbTf);
    files.push('loadbalancer.tf');
    resourceCount += 3; // ALB + target group + listener
  }

  // cdn.tf — conditional
  if (strategy.network.cdn) {
    const cdnTf = generateCdnHCL();
    writeFile(outputDir, 'cdn.tf', cdnTf);
    files.push('cdn.tf');
    resourceCount += 1;
  }

  // waf.tf — conditional
  if (strategy.network.waf) {
    const wafTf = generateWafHCL(security);
    writeFile(outputDir, 'waf.tf', wafTf);
    files.push('waf.tf');
    resourceCount += 2; // web ACL + association
  }

  // cache.tf — conditional
  if (strategy.cache) {
    const cacheTf = generateCacheHCL(strategy);
    writeFile(outputDir, 'cache.tf', cacheTf);
    files.push('cache.tf');
    resourceCount += 2; // replication group + subnet group
  }

  // queue.tf — conditional
  if (strategy.queue) {
    const queueTf = generateQueueHCL(strategy);
    writeFile(outputDir, 'queue.tf', queueTf);
    files.push('queue.tf');
    resourceCount += 1;
  }

  // streaming.tf — conditional
  if (strategy.streaming) {
    const streamingTf = generateStreamingHCL(strategy);
    writeFile(outputDir, 'streaming.tf', streamingTf);
    files.push('streaming.tf');
    resourceCount += 1;
  }

  // dns.tf — always
  const dnsTf = generateDnsHCL(projectName);
  writeFile(outputDir, 'dns.tf', dnsTf);
  files.push('dns.tf');
  resourceCount += 2; // zone + record

  // outputs.tf — always
  const outputsTf = generateOutputsHCL(strategy);
  writeFile(outputDir, 'outputs.tf', outputsTf);
  files.push('outputs.tf');

  // terraform.tfvars
  const tfvarsTf = generateTfvarsHCL(projectName, region);
  writeFile(outputDir, 'terraform.tfvars', tfvarsTf);
  files.push('terraform.tfvars');

  return { outputDir, files, resourceCount };
}

// ── Individual HCL generators ──

function generateMainHCL(region: string): string {
  return `terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      ManagedBy = "launchpilot"
      Project   = var.project_name
    }
  }
}
`;
}

function generateVariablesHCL(projectName: string, region: string): string {
  return `variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "${projectName}"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "${region}"
}

variable "container_port" {
  description = "Port the application container listens on"
  type        = number
  default     = 3000
}
`;
}

function generateVpcHCL(): string {
  return `# ── VPC with 2 public + 2 private subnets across 2 AZs ──

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = { Name = "\${var.project_name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "\${var.project_name}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = { Name = "\${var.project_name}-public-\${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = { Name = "\${var.project_name}-private-\${count.index}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "\${var.project_name}-nat-eip" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id

  tags = { Name = "\${var.project_name}-nat" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "\${var.project_name}-public-rt" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = { Name = "\${var.project_name}-private-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
`;
}

function generateSecurityHCL(security: SecurityPolicy, strategy: ScalingStrategy): string {
  const containerPort = 3000;

  let hcl = `# ── Security Groups ──

resource "aws_security_group" "web" {
  name_prefix = "\${var.project_name}-web-"
  description = "Allow HTTPS and HTTP traffic"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "\${var.project_name}-web-sg" }
}

resource "aws_security_group" "app" {
  name_prefix = "\${var.project_name}-app-"
  description = "Allow traffic from web tier"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "App port from web"
    from_port       = ${containerPort}
    to_port         = ${containerPort}
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "\${var.project_name}-app-sg" }
}
`;

  if (strategy.database) {
    const dbPort = strategy.database.engine === 'postgresql' ? 5432 : 3306;
    hcl += `
resource "aws_security_group" "db" {
  name_prefix = "\${var.project_name}-db-"
  description = "Allow traffic from app tier only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "DB port from app"
    from_port       = ${dbPort}
    to_port         = ${dbPort}
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "\${var.project_name}-db-sg" }
}
`;
  }

  return hcl;
}

function generateComputeHCL(strategy: ScalingStrategy, projectName: string): string {
  const fargate = mapInstanceToFargate(strategy.compute.instanceType);

  let hcl = `# ── ECS Fargate ──

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/\${var.project_name}"
  retention_in_days = 30
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "\${var.project_name}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_cluster" "main" {
  name = "\${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "\${var.project_name}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = ${fargate.cpu}
  memory                   = ${fargate.memory}
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name      = "${projectName}-app"
    image     = "nginx:alpine"  # Placeholder — replace with actual container image
    essential = true
    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = "\${var.project_name}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = ${strategy.compute.count}
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }
`;

  if (strategy.network.loadBalancer) {
    hcl += `
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "${projectName}-app"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.http]
`;
  }

  hcl += `}
`;

  // Auto-scaling
  if (strategy.compute.autoScaling && strategy.compute.minInstances && strategy.compute.maxInstances) {
    hcl += `
resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = ${strategy.compute.maxInstances}
  min_capacity       = ${strategy.compute.minInstances}
  resource_id        = "service/\${aws_ecs_cluster.main.name}/\${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  name               = "\${var.project_name}-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70.0
  }
}
`;
  }

  return hcl;
}

function generateDatabaseHCL(strategy: ScalingStrategy): string {
  const db = strategy.database!;
  const engine = db.engine === 'postgresql' ? 'postgres' : db.engine;
  const engineVersion = engine === 'postgres' ? '16.1' : '8.0';
  const port = engine === 'postgres' ? 5432 : 3306;

  let hcl = `# ── RDS Database ──

resource "aws_db_subnet_group" "main" {
  name       = "\${var.project_name}-db-subnet"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "\${var.project_name}-db-subnet-group" }
}

resource "aws_db_instance" "main" {
  identifier           = "\${var.project_name}-db"
  engine               = "${engine}"
  engine_version       = "${engineVersion}"
  instance_class       = "${db.instanceType}"
  allocated_storage    = ${db.storageGB}
  storage_encrypted    = true
  multi_az             = ${db.multiAZ}
  port                 = ${port}
  db_name              = "app"
  username             = "appuser"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  backup_retention_period = 7
  skip_final_snapshot     = true
  deletion_protection     = false

  tags = { Name = "\${var.project_name}-db" }
}
`;

  // Read replicas
  for (let i = 0; i < db.readReplicas; i++) {
    hcl += `
resource "aws_db_instance" "replica_${i}" {
  identifier          = "\${var.project_name}-db-replica-${i}"
  replicate_source_db = aws_db_instance.main.identifier
  instance_class      = "${db.instanceType}"
  storage_encrypted   = true

  tags = { Name = "\${var.project_name}-db-replica-${i}" }
}
`;
  }

  return hcl;
}

function generateLoadBalancerHCL(strategy: ScalingStrategy, _security: SecurityPolicy): string {
  return `# ── Application Load Balancer ──

resource "aws_lb" "app" {
  name               = "\${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.web.id]
  subnets            = aws_subnet.public[*].id

  tags = { Name = "\${var.project_name}-alb" }
}

resource "aws_lb_target_group" "app" {
  name        = "\${var.project_name}-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
  }

  tags = { Name = "\${var.project_name}-tg" }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
`;
}

function generateCdnHCL(): string {
  return `# ── CloudFront CDN ──

resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = ""
  price_class         = "PriceClass_100"

  origin {
    domain_name = aws_lb.app.dns_name
    origin_id   = "alb"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "alb"

    forwarded_values {
      query_string = true
      headers      = ["Host", "Origin"]

      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "\${var.project_name}-cdn" }
}
`;
}

function generateWafHCL(security: SecurityPolicy): string {
  const rateLimit = security.waf.rateLimitRpm * 5; // Convert RPM to 5-minute window

  return `# ── WAFv2 Web ACL ──

resource "aws_wafv2_web_acl" "main" {
  name        = "\${var.project_name}-waf"
  description = "WAF rules for \${var.project_name}"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = ${rateLimit}
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "\${var.project_name}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-managed-common"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "\${var.project_name}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-managed-sqli"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "\${var.project_name}-sqli-rules"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "\${var.project_name}-waf"
    sampled_requests_enabled   = true
  }

  tags = { Name = "\${var.project_name}-waf" }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.app.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}
`;
}

function generateCacheHCL(strategy: ScalingStrategy): string {
  const cache = strategy.cache!;
  const engine = cache.engine === 'redis' ? 'redis' : 'memcached';

  return `# ── ElastiCache ──

resource "aws_elasticache_subnet_group" "main" {
  name       = "\${var.project_name}-cache-subnet"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "\${var.project_name}-cache"
  description          = "Cache for \${var.project_name}"
  node_type            = "${cache.nodeType}"
  num_cache_clusters   = ${cache.nodes}
  engine               = "${engine}"
  engine_version       = "${engine === 'redis' ? '7.1' : '1.6.22'}"
  port                 = ${engine === 'redis' ? 6379 : 11211}
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.app.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = ${engine === 'redis' ? 'true' : 'false'}

  tags = { Name = "\${var.project_name}-cache" }
}
`;
}

function generateQueueHCL(strategy: ScalingStrategy): string {
  const queue = strategy.queue!;
  const isFifo = queue.type.toLowerCase().includes('fifo');

  return `# ── SQS Queue ──

resource "aws_sqs_queue" "main" {
  name                       = "\${var.project_name}-queue${isFifo ? '.fifo' : ''}"
  ${isFifo ? 'fifo_queue                  = true' : ''}
  delay_seconds              = 0
  max_message_size           = 262144
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 10
  visibility_timeout_seconds = 60

  tags = { Name = "\${var.project_name}-queue" }
}
`;
}

function generateStreamingHCL(strategy: ScalingStrategy): string {
  const streaming = strategy.streaming!;

  return `# ── Kinesis Stream ──

resource "aws_kinesis_stream" "main" {
  name             = "\${var.project_name}-stream"
  shard_count      = ${streaming.shards}
  retention_period = ${streaming.retentionHours}

  stream_mode_details {
    stream_mode = "PROVISIONED"
  }

  tags = { Name = "\${var.project_name}-stream" }
}
`;
}

function generateDnsHCL(projectName: string): string {
  return `# ── Route 53 ──

resource "aws_route53_zone" "main" {
  name = "${projectName}.app"

  tags = { Name = "\${var.project_name}-zone" }
}

resource "aws_route53_record" "app" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "${projectName}.app"
  type    = "A"

  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}
`;
}

function generateOutputsHCL(strategy: ScalingStrategy): string {
  let hcl = `# ── Outputs ──

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "ecs_cluster_arn" {
  description = "ECS Cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "ecs_service_name" {
  description = "ECS Service name"
  value       = aws_ecs_service.app.name
}
`;

  if (strategy.network.loadBalancer) {
    hcl += `
output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.app.dns_name
}

output "alb_arn" {
  description = "ALB ARN"
  value       = aws_lb.app.arn
}

output "app_url" {
  description = "Application URL"
  value       = "http://\${aws_lb.app.dns_name}"
}

output "dashboard_url" {
  description = "AWS Console URL"
  value       = "https://\${var.region}.console.aws.amazon.com/ecs/v2/clusters/\${aws_ecs_cluster.main.name}/services/\${aws_ecs_service.app.name}"
}
`;
  }

  if (strategy.database) {
    hcl += `
output "rds_endpoint" {
  description = "RDS endpoint"
  value       = aws_db_instance.main.endpoint
}
`;
  }

  if (strategy.network.cdn) {
    hcl += `
output "cloudfront_distribution_id" {
  description = "CloudFront Distribution ID"
  value       = aws_cloudfront_distribution.app.id
}
`;
  }

  if (strategy.network.waf) {
    hcl += `
output "waf_acl_id" {
  description = "WAF Web ACL ID"
  value       = aws_wafv2_web_acl.main.id
}
`;
  }

  if (strategy.cache) {
    hcl += `
output "elasticache_endpoint" {
  description = "ElastiCache endpoint"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}
`;
  }

  if (strategy.queue) {
    hcl += `
output "sqs_queue_url" {
  description = "SQS Queue URL"
  value       = aws_sqs_queue.main.url
}
`;
  }

  if (strategy.streaming) {
    hcl += `
output "kinesis_stream_arn" {
  description = "Kinesis Stream ARN"
  value       = aws_kinesis_stream.main.arn
}
`;
  }

  hcl += `
output "route53_zone_id" {
  description = "Route53 Zone ID"
  value       = aws_route53_zone.main.zone_id
}
`;

  return hcl;
}

function generateTfvarsHCL(projectName: string, region: string): string {
  return `project_name   = "${projectName}"
region         = "${region}"
container_port = 3000
`;
}

// ── Helpers ──

function writeFile(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, 'utf-8');
}
