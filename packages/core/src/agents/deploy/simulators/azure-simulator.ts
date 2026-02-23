import { Checkpoint, ScalingStrategy, DeployedResource } from '../../../types/index';
import { createCheckpoint } from '../checkpoint';
import { generateResourceId } from '../mock-url-generator';
import { CloudProvider } from '../../../types/cloud-provider.types';

export function getAzureCheckpoints(strategy: ScalingStrategy): Checkpoint[] {
  const checkpoints: Checkpoint[] = [
    createCheckpoint('Create Resource Group', 'Creating Azure Resource Group in East US'),
    createCheckpoint('Create VNet', 'Provisioning Virtual Network with subnets'),
    createCheckpoint('Configure NSGs', 'Setting up Network Security Group rules'),
    createCheckpoint('Launch VMs', `Provisioning ${strategy.compute.count}x ${strategy.compute.instanceType} VMs`),
  ];

  if (strategy.database) {
    checkpoints.push(
      createCheckpoint('Create Azure SQL', `Provisioning ${strategy.database.instanceType} (${strategy.database.engine})`)
    );
  }

  if (strategy.network.loadBalancer) {
    checkpoints.push(
      createCheckpoint('Create App Gateway', 'Provisioning Application Gateway with backend pool')
    );
  }

  if (strategy.network.cdn) {
    checkpoints.push(
      createCheckpoint('Configure Front Door', 'Setting up Azure Front Door with CDN')
    );
  }

  if (strategy.network.waf) {
    checkpoints.push(
      createCheckpoint('Deploy WAF Policy', 'Creating WAF policy with OWASP managed rules')
    );
  }

  if (strategy.cache) {
    checkpoints.push(
      createCheckpoint('Create Azure Cache', `Provisioning Azure Cache for Redis ${strategy.cache.nodeType} x${strategy.cache.nodes}`)
    );
  }

  if (strategy.queue) {
    checkpoints.push(
      createCheckpoint('Create Service Bus', `Creating ${strategy.queue.type} namespace and queue`)
    );
  }

  if (strategy.streaming) {
    checkpoints.push(
      createCheckpoint('Create Event Hubs', `Provisioning ${strategy.streaming.type} with ${strategy.streaming.shards} partitions`)
    );
  }

  checkpoints.push(
    createCheckpoint('Deploy Application', 'Building container and deploying to App Service'),
    createCheckpoint('Health Check', 'Verifying application health probe'),
    createCheckpoint('Configure Azure DNS', 'Setting up DNS zone and records'),
  );

  return checkpoints;
}

export function getAzureResources(strategy: ScalingStrategy): DeployedResource[] {
  const resources: DeployedResource[] = [
    { type: 'Resource Group', name: 'rg-launchpilot', id: '/subscriptions/xxx/resourceGroups/rg-launchpilot', status: 'Succeeded' },
    { type: 'VNet', name: 'vnet-launchpilot', id: generateResourceId(CloudProvider.Azure, 'vnet'), status: 'Succeeded' },
  ];

  for (let i = 0; i < strategy.compute.count; i++) {
    resources.push({
      type: 'Virtual Machine',
      name: `vm-app-${i + 1}`,
      id: generateResourceId(CloudProvider.Azure, 'vm'),
      status: 'Running',
    });
  }

  if (strategy.database) {
    resources.push({
      type: 'Azure SQL',
      name: 'sql-launchpilot',
      id: generateResourceId(CloudProvider.Azure, 'sql'),
      status: 'Ready',
    });
  }

  if (strategy.cache) {
    resources.push({
      type: 'Azure Cache',
      name: 'cache-launchpilot',
      id: generateResourceId(CloudProvider.Azure, 'cache'),
      status: 'Running',
    });
  }

  if (strategy.queue) {
    resources.push({
      type: 'Service Bus',
      name: 'sb-launchpilot',
      id: generateResourceId(CloudProvider.Azure, 'servicebus'),
      status: 'Active',
    });
  }

  if (strategy.streaming) {
    resources.push({
      type: 'Event Hubs',
      name: 'eh-launchpilot',
      id: generateResourceId(CloudProvider.Azure, 'eventhubs'),
      status: 'Active',
    });
  }

  return resources;
}

export function getAzureLogLine(checkpointName: string): string {
  const lines: Record<string, string> = {
    'Create Resource Group': 'az group create --name rg-launchpilot --location eastus',
    'Create VNet': 'az network vnet create --resource-group rg-launchpilot --name vnet-launchpilot --address-prefix 10.0.0.0/16',
    'Configure NSGs': 'az network nsg rule create --resource-group rg-launchpilot --nsg-name nsg-web --name AllowHTTPS --priority 100 --destination-port-ranges 443',
    'Launch VMs': 'az vm create --resource-group rg-launchpilot --name vm-app-1 --image UbuntuLTS --size Standard_D2s_v5',
    'Create Azure SQL': 'az sql server create --resource-group rg-launchpilot --name sql-launchpilot --admin-user admin',
    'Create App Gateway': 'az network application-gateway create --resource-group rg-launchpilot --name appgw-launchpilot',
    'Configure Front Door': 'az afd profile create --resource-group rg-launchpilot --profile-name fd-launchpilot --sku Standard_AzureFrontDoor',
    'Deploy WAF Policy': 'az network application-gateway waf-policy create --resource-group rg-launchpilot --name waf-launchpilot',
    'Create Azure Cache': 'az redis create --resource-group rg-launchpilot --name cache-launchpilot --sku Basic --vm-size c0',
    'Create Service Bus': 'az servicebus namespace create --resource-group rg-launchpilot --name sb-launchpilot --sku Standard',
    'Create Event Hubs': 'az eventhubs namespace create --resource-group rg-launchpilot --name eh-launchpilot --sku Standard',
    'Deploy Application': 'az webapp create --resource-group rg-launchpilot --plan asp-launchpilot --name app-launchpilot --deployment-container-image-name app:latest',
    'Health Check': 'curl -sf https://app-launchpilot.azurewebsites.net/health → HTTP 200 OK',
    'Configure Azure DNS': 'az network dns record-set a add-record --resource-group rg-launchpilot --zone-name example.com --record-set-name app',
  };
  return lines[checkpointName] ?? `Executing: ${checkpointName}`;
}
