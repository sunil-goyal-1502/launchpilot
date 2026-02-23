import { Checkpoint, ScalingStrategy, DeployedResource } from '../../../types/index';
import { createCheckpoint } from '../checkpoint';
import { generateResourceId } from '../mock-url-generator';
import { CloudProvider } from '../../../types/cloud-provider.types';

export function getGCPCheckpoints(strategy: ScalingStrategy): Checkpoint[] {
  const checkpoints: Checkpoint[] = [
    createCheckpoint('Create VPC Network', 'Provisioning VPC network with subnets'),
    createCheckpoint('Configure Firewall Rules', 'Setting up firewall rules for ingress/egress'),
    createCheckpoint('Launch Compute Instances', `Provisioning ${strategy.compute.count}x ${strategy.compute.instanceType} instances`),
  ];

  if (strategy.database) {
    checkpoints.push(
      createCheckpoint('Create Cloud SQL', `Provisioning ${strategy.database.instanceType} (${strategy.database.engine})`)
    );
  }

  if (strategy.network.loadBalancer) {
    checkpoints.push(
      createCheckpoint('Create Load Balancer', 'Setting up Cloud Load Balancer with backend service')
    );
  }

  if (strategy.network.cdn) {
    checkpoints.push(
      createCheckpoint('Configure Cloud CDN', 'Enabling Cloud CDN on backend service')
    );
  }

  if (strategy.network.waf) {
    checkpoints.push(
      createCheckpoint('Deploy Cloud Armor', 'Creating Cloud Armor security policy')
    );
  }

  if (strategy.cache) {
    checkpoints.push(
      createCheckpoint('Create Memorystore', `Provisioning Memorystore ${strategy.cache.nodeType} (${strategy.cache.engine})`)
    );
  }

  if (strategy.queue) {
    checkpoints.push(
      createCheckpoint('Create Cloud Tasks Queue', `Creating ${strategy.queue.type} queue`)
    );
  }

  if (strategy.streaming) {
    checkpoints.push(
      createCheckpoint('Create Pub/Sub Topic', `Creating Pub/Sub topic with ${strategy.streaming.shards} subscriptions`)
    );
  }

  checkpoints.push(
    createCheckpoint('Deploy Application', 'Building container and deploying to Cloud Run'),
    createCheckpoint('Health Check', 'Verifying application readiness probe'),
    createCheckpoint('Configure Cloud DNS', 'Setting up DNS records'),
  );

  return checkpoints;
}

export function getGCPResources(strategy: ScalingStrategy): DeployedResource[] {
  const resources: DeployedResource[] = [
    { type: 'VPC Network', name: 'launchpilot-vpc', id: generateResourceId(CloudProvider.GCP, 'vpc'), status: 'READY' },
  ];

  for (let i = 0; i < strategy.compute.count; i++) {
    resources.push({
      type: 'Compute Instance',
      name: `app-${i + 1}`,
      id: generateResourceId(CloudProvider.GCP, 'instance'),
      status: 'RUNNING',
    });
  }

  if (strategy.database) {
    resources.push({
      type: 'Cloud SQL',
      name: 'db-primary',
      id: generateResourceId(CloudProvider.GCP, 'sql'),
      status: 'RUNNABLE',
    });
  }

  if (strategy.cache) {
    resources.push({
      type: 'Memorystore',
      name: 'cache-primary',
      id: generateResourceId(CloudProvider.GCP, 'memorystore'),
      status: 'READY',
    });
  }

  if (strategy.queue) {
    resources.push({
      type: 'Cloud Tasks',
      name: 'app-queue',
      id: generateResourceId(CloudProvider.GCP, 'tasks'),
      status: 'READY',
    });
  }

  if (strategy.streaming) {
    resources.push({
      type: 'Pub/Sub',
      name: 'app-topic',
      id: generateResourceId(CloudProvider.GCP, 'pubsub'),
      status: 'READY',
    });
  }

  return resources;
}

export function getGCPLogLine(checkpointName: string): string {
  const lines: Record<string, string> = {
    'Create VPC Network': 'gcloud compute networks create launchpilot-vpc --subnet-mode=custom',
    'Configure Firewall Rules': 'gcloud compute firewall-rules create allow-https --network launchpilot-vpc --allow tcp:443',
    'Launch Compute Instances': 'gcloud compute instances create app-1 --zone=us-central1-a --machine-type=e2-standard-2',
    'Create Cloud SQL': 'gcloud sql instances create launchpilot-db --database-version=POSTGRES_15 --tier=db-n1-standard-1',
    'Create Load Balancer': 'gcloud compute backend-services create app-backend --protocol=HTTP --health-checks=app-hc',
    'Configure Cloud CDN': 'gcloud compute backend-services update app-backend --enable-cdn',
    'Deploy Cloud Armor': 'gcloud compute security-policies create launchpilot-policy --description="OWASP rules"',
    'Create Memorystore': 'gcloud redis instances create launchpilot-cache --size=1 --region=us-central1 --redis-version=redis_7_0',
    'Create Cloud Tasks Queue': 'gcloud tasks queues create launchpilot-queue --location=us-central1',
    'Create Pub/Sub Topic': 'gcloud pubsub topics create launchpilot-stream && gcloud pubsub subscriptions create launchpilot-sub --topic=launchpilot-stream',
    'Deploy Application': 'gcloud run deploy app --image gcr.io/launchpilot/app:latest --region us-central1 --allow-unauthenticated',
    'Health Check': 'curl -sf https://app-xxx-uc.a.run.app/health → HTTP 200 OK',
    'Configure Cloud DNS': 'gcloud dns record-sets create app.example.com --zone=launchpilot-zone --type=A',
  };
  return lines[checkpointName] ?? `Executing: ${checkpointName}`;
}
