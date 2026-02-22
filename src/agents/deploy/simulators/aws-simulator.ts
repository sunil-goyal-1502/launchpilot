import { Checkpoint, ScalingStrategy, DeployedResource } from '../../../types/index.js';
import { createCheckpoint } from '../checkpoint.js';
import { generateResourceId } from '../mock-url-generator.js';
import { CloudProvider } from '../../../types/cloud-provider.types.js';

export function getAWSCheckpoints(strategy: ScalingStrategy): Checkpoint[] {
  const checkpoints: Checkpoint[] = [
    createCheckpoint('Create VPC', 'Provisioning VPC with public and private subnets'),
    createCheckpoint('Configure Security Groups', 'Setting up security group rules'),
    createCheckpoint('Launch Compute', `Provisioning ${strategy.compute.count}x ${strategy.compute.instanceType} instances`),
  ];

  if (strategy.database) {
    checkpoints.push(
      createCheckpoint('Create RDS Instance', `Provisioning ${strategy.database.instanceType} (${strategy.database.engine})`)
    );
  }

  if (strategy.network.loadBalancer) {
    checkpoints.push(
      createCheckpoint('Create ALB', 'Provisioning Application Load Balancer with target groups')
    );
  }

  if (strategy.network.cdn) {
    checkpoints.push(
      createCheckpoint('Configure CloudFront', 'Setting up CloudFront distribution with origin')
    );
  }

  if (strategy.network.waf) {
    checkpoints.push(
      createCheckpoint('Deploy WAF', 'Creating WAF Web ACL with OWASP rules')
    );
  }

  if (strategy.cache) {
    checkpoints.push(
      createCheckpoint('Create ElastiCache', `Provisioning ${strategy.cache.nodeType} x${strategy.cache.nodes} (${strategy.cache.engine})`)
    );
  }

  if (strategy.queue) {
    checkpoints.push(
      createCheckpoint('Create SQS Queue', `Creating ${strategy.queue.type} queue`)
    );
  }

  if (strategy.streaming) {
    checkpoints.push(
      createCheckpoint('Create Streaming', `Provisioning ${strategy.streaming.type} with ${strategy.streaming.shards} shards`)
    );
  }

  checkpoints.push(
    createCheckpoint('Deploy Application', 'Building and deploying application container'),
    createCheckpoint('Health Check', 'Verifying application health endpoint responds'),
    createCheckpoint('Configure DNS', 'Setting up Route 53 records'),
  );

  return checkpoints;
}

export function getAWSResources(strategy: ScalingStrategy): DeployedResource[] {
  const resources: DeployedResource[] = [
    { type: 'VPC', name: 'launchpilot-vpc', id: generateResourceId(CloudProvider.AWS, 'vpc'), status: 'active' },
    { type: 'Security Group', name: 'sg-web', id: generateResourceId(CloudProvider.AWS, 'sg'), status: 'active' },
  ];

  for (let i = 0; i < strategy.compute.count; i++) {
    resources.push({
      type: 'EC2 Instance',
      name: `app-${i + 1}`,
      id: generateResourceId(CloudProvider.AWS, 'instance'),
      status: 'running',
    });
  }

  if (strategy.database) {
    resources.push({
      type: 'RDS Instance',
      name: 'db-primary',
      id: generateResourceId(CloudProvider.AWS, 'rds'),
      status: 'available',
    });
  }

  if (strategy.network.loadBalancer) {
    resources.push({
      type: 'ALB',
      name: 'app-lb',
      id: generateResourceId(CloudProvider.AWS, 'alb'),
      status: 'active',
    });
  }

  if (strategy.cache) {
    resources.push({
      type: 'ElastiCache',
      name: 'cache-primary',
      id: generateResourceId(CloudProvider.AWS, 'elasticache'),
      status: 'available',
    });
  }

  if (strategy.queue) {
    resources.push({
      type: 'SQS Queue',
      name: 'app-queue',
      id: generateResourceId(CloudProvider.AWS, 'sqs'),
      status: 'active',
    });
  }

  if (strategy.streaming) {
    resources.push({
      type: 'Kinesis/MSK',
      name: 'app-stream',
      id: generateResourceId(CloudProvider.AWS, 'kinesis'),
      status: 'active',
    });
  }

  return resources;
}

export function getAWSLogLine(checkpointName: string): string {
  const lines: Record<string, string> = {
    'Create VPC': 'aws ec2 create-vpc --cidr-block 10.0.0.0/16 --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=launchpilot-vpc}]"',
    'Configure Security Groups': 'aws ec2 authorize-security-group-ingress --group-id sg-xxx --protocol tcp --port 443 --cidr 0.0.0.0/0',
    'Launch Compute': 'aws ecs create-service --cluster launchpilot --service-name app --task-definition app:1 --desired-count 2',
    'Create RDS Instance': 'aws rds create-db-instance --db-instance-identifier launchpilot-db --engine postgres --db-instance-class db.t3.medium',
    'Create ALB': 'aws elbv2 create-load-balancer --name app-lb --subnets subnet-xxx subnet-yyy --security-groups sg-xxx',
    'Configure CloudFront': 'aws cloudfront create-distribution --origin-domain-name app-lb.us-east-1.elb.amazonaws.com',
    'Deploy WAF': 'aws wafv2 create-web-acl --name launchpilot-waf --scope REGIONAL --default-action Allow={}',
    'Create ElastiCache': 'aws elasticache create-replication-group --replication-group-id launchpilot-cache --engine redis --cache-node-type cache.t3.medium',
    'Create SQS Queue': 'aws sqs create-queue --queue-name launchpilot-queue --attributes DelaySeconds=0',
    'Create Streaming': 'aws kinesis create-stream --stream-name launchpilot-stream --shard-count 2',
    'Deploy Application': 'docker build -t app:latest . && aws ecr get-login-password | docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/app:latest',
    'Health Check': 'curl -sf https://app-lb.us-east-1.elb.amazonaws.com/health → HTTP 200 OK',
    'Configure DNS': 'aws route53 change-resource-record-sets --hosted-zone-id Z1234 --change-batch ...',
  };
  return lines[checkpointName] ?? `Executing: ${checkpointName}`;
}
