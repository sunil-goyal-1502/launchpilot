import { CostBreakdown, CostLineItem, CloudProvider, ScalingStrategy } from '../../types/index.js';
import { getAWSPrices, getComputePrice as awsCompute, getDBPrice as awsDB, getNetworkPrice as awsNet, getSecurityPrice as awsSec, getCachePrice as awsCache, getQueuePrice as awsQueue, getStreamPrice as awsStream } from './pricing/aws-pricing.js';
import { getGCPPrices, getComputePrice as gcpCompute, getDBPrice as gcpDB, getNetworkPrice as gcpNet, getSecurityPrice as gcpSec, getCachePrice as gcpCache, getQueuePrice as gcpQueue, getStreamPrice as gcpStream } from './pricing/gcp-pricing.js';
import { getAzurePrices, getComputePrice as azureCompute, getDBPrice as azureDB, getNetworkPrice as azureNet, getSecurityPrice as azureSec, getCachePrice as azureCache, getQueuePrice as azureQueue, getStreamPrice as azureStream } from './pricing/azure-pricing.js';

const HOURS_PER_MONTH = 730;
const RESERVED_DISCOUNT = 0.35;

function getComputePrice(provider: CloudProvider, instanceType: string): number {
  switch (provider) {
    case CloudProvider.AWS: return awsCompute(instanceType);
    case CloudProvider.GCP: return gcpCompute(instanceType);
    case CloudProvider.Azure: return azureCompute(instanceType);
  }
}

function getDBPrice(provider: CloudProvider, instanceType: string): number {
  switch (provider) {
    case CloudProvider.AWS: return awsDB(instanceType);
    case CloudProvider.GCP: return gcpDB(instanceType);
    case CloudProvider.Azure: return azureDB(instanceType);
  }
}

function getNetPrice(provider: CloudProvider, key: string): number {
  switch (provider) {
    case CloudProvider.AWS: return awsNet(key);
    case CloudProvider.GCP: return gcpNet(key);
    case CloudProvider.Azure: return azureNet(key);
  }
}

function getSecPrice(provider: CloudProvider, key: string): number {
  switch (provider) {
    case CloudProvider.AWS: return awsSec(key);
    case CloudProvider.GCP: return gcpSec(key);
    case CloudProvider.Azure: return azureSec(key);
  }
}

function getCachePriceByProvider(provider: CloudProvider, nodeType: string): number {
  switch (provider) {
    case CloudProvider.AWS: return awsCache(nodeType);
    case CloudProvider.GCP: return gcpCache(nodeType);
    case CloudProvider.Azure: return azureCache(nodeType);
  }
}

function getQueuePriceByProvider(provider: CloudProvider, key: string): number {
  switch (provider) {
    case CloudProvider.AWS: return awsQueue(key);
    case CloudProvider.GCP: return gcpQueue(key);
    case CloudProvider.Azure: return azureQueue(key);
  }
}

function getStreamPriceByProvider(provider: CloudProvider, key: string): number {
  switch (provider) {
    case CloudProvider.AWS: return awsStream(key);
    case CloudProvider.GCP: return gcpStream(key);
    case CloudProvider.Azure: return azureStream(key);
  }
}

export function calculateCost(strategy: ScalingStrategy): CostBreakdown {
  const provider = strategy.provider;
  const items: CostLineItem[] = [];

  // Compute costs
  const computeHourly = getComputePrice(provider, strategy.compute.instanceType);
  const computeMonthly = computeHourly * HOURS_PER_MONTH * strategy.compute.count;
  items.push({
    service: 'Compute',
    resource: `${strategy.compute.instanceType} x${strategy.compute.count}`,
    unit: 'hours',
    quantity: HOURS_PER_MONTH * strategy.compute.count,
    unitPrice: computeHourly,
    monthlyTotal: round(computeMonthly),
  });

  // Database costs
  if (strategy.database) {
    const dbHourly = getDBPrice(provider, strategy.database.instanceType);
    let dbMonthly = dbHourly * HOURS_PER_MONTH;
    if (strategy.database.multiAZ) dbMonthly *= 2;
    dbMonthly += strategy.database.readReplicas * dbHourly * HOURS_PER_MONTH;

    items.push({
      service: 'Database',
      resource: strategy.database.instanceType,
      unit: 'hours',
      quantity: HOURS_PER_MONTH,
      unitPrice: dbHourly,
      monthlyTotal: round(dbMonthly),
    });

    // Database storage
    const storageKey = provider === CloudProvider.AWS ? 'gp3PerGB'
      : provider === CloudProvider.GCP ? 'pdSsdPerGB'
      : 'premiumSSDPerGB';
    const storagePrice = getStoragePrice(provider, storageKey);
    items.push({
      service: 'Database Storage',
      resource: `${strategy.database.storageGB} GB`,
      unit: 'GB-month',
      quantity: strategy.database.storageGB,
      unitPrice: storagePrice,
      monthlyTotal: round(strategy.database.storageGB * storagePrice),
    });
  }

  // Load Balancer
  if (strategy.network.loadBalancer) {
    const lbKey = provider === CloudProvider.AWS ? 'albHourly'
      : provider === CloudProvider.GCP ? 'lbHourly'
      : 'appGatewayHourly';
    const lbHourly = getNetPrice(provider, lbKey);
    items.push({
      service: 'Load Balancer',
      resource: strategy.network.loadBalancerType ?? 'Application LB',
      unit: 'hours',
      quantity: HOURS_PER_MONTH,
      unitPrice: lbHourly,
      monthlyTotal: round(lbHourly * HOURS_PER_MONTH),
    });
  }

  // CDN
  if (strategy.network.cdn) {
    const cdnKey = provider === CloudProvider.AWS ? 'cloudFrontPerGB'
      : provider === CloudProvider.GCP ? 'cloudCDNPerGB'
      : 'frontDoorPerGB';
    const cdnPrice = getNetPrice(provider, cdnKey);
    const estimatedGB = strategy.tier === 'low' ? 50 : strategy.tier === 'medium' ? 200 : 1000;
    items.push({
      service: 'CDN',
      resource: `${estimatedGB} GB transfer`,
      unit: 'GB',
      quantity: estimatedGB,
      unitPrice: cdnPrice,
      monthlyTotal: round(estimatedGB * cdnPrice),
    });
  }

  // NAT Gateway
  if (strategy.network.natGateway) {
    const natHourly = getNetPrice(provider, 'natGatewayHourly');
    items.push({
      service: 'NAT Gateway',
      resource: 'NAT Gateway',
      unit: 'hours',
      quantity: HOURS_PER_MONTH,
      unitPrice: natHourly,
      monthlyTotal: round(natHourly * HOURS_PER_MONTH),
    });
  }

  // WAF
  if (strategy.network.waf) {
    const wafKey = provider === CloudProvider.AWS ? 'wafMonthly'
      : provider === CloudProvider.GCP ? 'cloudArmorPolicyMonthly'
      : 'wafPolicyMonthly';
    const wafBase = getSecPrice(provider, wafKey);
    const ruleCount = strategy.tier === 'low' ? 3 : strategy.tier === 'medium' ? 6 : 10;
    const ruleKey = provider === CloudProvider.AWS ? 'wafRuleMonthly'
      : provider === CloudProvider.GCP ? 'cloudArmorRuleMonthly'
      : 'wafRuleMonthly';
    const rulePrice = getSecPrice(provider, ruleKey);
    items.push({
      service: 'WAF',
      resource: `${ruleCount} rules`,
      unit: 'month',
      quantity: 1,
      unitPrice: wafBase + ruleCount * rulePrice,
      monthlyTotal: round(wafBase + ruleCount * rulePrice),
    });
  }

  // Cache
  if (strategy.cache) {
    const cacheHourly = getCachePriceByProvider(provider, strategy.cache.nodeType);
    const cacheMonthly = cacheHourly * HOURS_PER_MONTH * strategy.cache.nodes;
    items.push({
      service: 'Cache',
      resource: `${strategy.cache.service} ${strategy.cache.nodeType} x${strategy.cache.nodes}`,
      unit: 'hours',
      quantity: HOURS_PER_MONTH * strategy.cache.nodes,
      unitPrice: cacheHourly,
      monthlyTotal: round(cacheMonthly),
    });
  }

  // Queue
  if (strategy.queue) {
    const queueKey = provider === CloudProvider.AWS
      ? (strategy.queue.type.includes('FIFO') ? 'sqsFifoPerMillion' : 'sqsPerMillion')
      : provider === CloudProvider.GCP ? 'cloudTasksPerMillion'
      : 'serviceBusPerMillion';
    const queuePricePerMillion = getQueuePriceByProvider(provider, queueKey);
    const millionsPerMonth = (strategy.queue.estimatedMessagesPerDay * 30) / 1_000_000;
    items.push({
      service: 'Queue',
      resource: `${strategy.queue.service} (${strategy.queue.type})`,
      unit: 'million messages',
      quantity: round(millionsPerMonth),
      unitPrice: queuePricePerMillion,
      monthlyTotal: round(millionsPerMonth * queuePricePerMillion),
    });
  }

  // Streaming
  if (strategy.streaming) {
    const streamKey = provider === CloudProvider.AWS
      ? (strategy.streaming.type.includes('MSK') ? 'mskServerlessHourly' : 'kinesisShardHourly')
      : provider === CloudProvider.GCP ? 'pubsubPerTBIngested'
      : 'eventHubsTUHourly';
    const streamPrice = getStreamPriceByProvider(provider, streamKey);
    const streamMonthly = provider === CloudProvider.GCP
      ? streamPrice * 0.5 // assume 0.5 TB/month for estimation
      : streamPrice * HOURS_PER_MONTH * strategy.streaming.shards;
    items.push({
      service: 'Streaming',
      resource: `${strategy.streaming.service} (${strategy.streaming.shards} shards)`,
      unit: provider === CloudProvider.GCP ? 'TB' : 'hours',
      quantity: provider === CloudProvider.GCP ? 0.5 : HOURS_PER_MONTH * strategy.streaming.shards,
      unitPrice: streamPrice,
      monthlyTotal: round(streamMonthly),
    });
  }

  // Auth service costs
  if (strategy.auth) {
    const authMonthly = strategy.tier === 'low' ? 0 : strategy.tier === 'medium' ? 25 : 150;
    if (authMonthly > 0) {
      items.push({
        service: 'Auth',
        resource: `${strategy.auth.service} (${strategy.auth.estimatedMAU.toLocaleString()} MAU)`,
        unit: 'month',
        quantity: 1,
        unitPrice: authMonthly,
        monthlyTotal: authMonthly,
      });
    }
  }

  // Object storage costs
  if (strategy.objectStorage) {
    const pricePerGB = provider === CloudProvider.AWS ? 0.023 : provider === CloudProvider.GCP ? 0.020 : 0.018;
    const storageCost = round(strategy.objectStorage.estimatedGB * pricePerGB);
    items.push({
      service: 'Object Storage',
      resource: `${strategy.objectStorage.service} (${strategy.objectStorage.estimatedGB} GB)`,
      unit: 'GB-month',
      quantity: strategy.objectStorage.estimatedGB,
      unitPrice: pricePerGB,
      monthlyTotal: storageCost,
    });
  }

  // Vendor subscription cost
  if (strategy.vendorSubscription && strategy.vendorSubscription.monthlyEstimate > 0) {
    items.push({
      service: 'Vendor Subscription',
      resource: `${strategy.vendorSubscription.vendorName} (${strategy.vendorSubscription.pricingTier})`,
      unit: 'month',
      quantity: 1,
      unitPrice: strategy.vendorSubscription.monthlyEstimate,
      monthlyTotal: strategy.vendorSubscription.monthlyEstimate,
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.monthlyTotal, 0);
  const reservedDiscount = strategy.tier !== 'low' ? round(subtotal * RESERVED_DISCOUNT) : 0;

  return {
    lineItems: items,
    subtotal: round(subtotal),
    reservedDiscount: round(reservedDiscount),
    total: round(subtotal - reservedDiscount),
    currency: 'USD',
  };
}

function getStoragePrice(provider: CloudProvider, key: string): number {
  switch (provider) {
    case CloudProvider.AWS:
      return (getAWSPrices().storage as Record<string, number>)[key] ?? 0.08;
    case CloudProvider.GCP:
      return (getGCPPrices().storage as Record<string, number>)[key] ?? 0.10;
    case CloudProvider.Azure:
      return (getAzurePrices().storage as Record<string, number>)[key] ?? 0.075;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
