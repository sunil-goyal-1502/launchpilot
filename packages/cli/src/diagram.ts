import chalk from 'chalk';
import {
  ScalingStrategy, SecurityPolicy, CloudProvider,
  getCDNLabel, getLBLabel, getComputeLabel, getDBLabel,
  getCacheLabel, getQueueLabel, getStreamLabel,
} from '@launchpilot/core';

/**
 * Renders an ASCII architecture diagram based on the deployment strategy.
 * Only shows layers that exist in the strategy (e.g., no CDN row if CDN is disabled).
 */
export function showArchitectureDiagram(strategy: ScalingStrategy, security: SecurityPolicy): void {
  const providerName = strategy.provider.toUpperCase();
  const tierName = strategy.tier === 'low' ? 'Starter' : strategy.tier === 'medium' ? 'Production' : 'Enterprise';

  console.log('');
  console.log(chalk.bold.white(`  Architecture Diagram — ${providerName} ${tierName}`));
  console.log(chalk.dim(`  ${'═'.repeat(50)}`));
  console.log('');

  const lines: string[] = [];

  // Layer 1: Internet
  lines.push(...renderBox('Internet', 'cyan'));
  lines.push(connector());

  // Layer 2: Edge (CDN + WAF) — only if either exists
  if (strategy.network.cdn || strategy.network.waf) {
    const edgeBoxes: BoxDef[] = [];
    if (strategy.network.cdn) {
      const cdnLabel = getCDNLabel(strategy.provider);
      edgeBoxes.push({ label: cdnLabel, sublabel: '(CDN)', color: 'yellow' });
    }
    if (strategy.network.waf) {
      const wafRules = strategy.securityTier === 'advanced' ? 10 : strategy.securityTier === 'standard' ? 6 : 3;
      edgeBoxes.push({ label: 'WAF/ACL', sublabel: `(${wafRules} rules)`, color: 'red' });
    }
    lines.push(...renderHorizontalBoxes(edgeBoxes));
    lines.push(connector());
  }

  // Layer 3: Load Balancer
  if (strategy.network.loadBalancer) {
    const lbLabel = getLBLabel(strategy.provider);
    lines.push(...renderBox(lbLabel, 'green'));
    lines.push(connector());
  }

  // Layer 4: Compute
  const computeLabel = getComputeLabel(strategy.provider, strategy.compute.instanceType);
  const computeBoxes: BoxDef[] = [];
  for (let i = 0; i < Math.min(strategy.compute.count, 4); i++) {
    computeBoxes.push({
      label: computeLabel,
      sublabel: strategy.compute.instanceType,
      color: 'blue',
    });
  }
  if (strategy.compute.count > 4) {
    computeBoxes.push({ label: `+${strategy.compute.count - 4}`, sublabel: 'more', color: 'blue' });
  }

  lines.push(...renderHorizontalBoxes(computeBoxes));

  if (strategy.compute.autoScaling) {
    lines.push(chalk.dim(`${pad()}     ◄── Auto Scale ${strategy.compute.minInstances}-${strategy.compute.maxInstances}`));
  }

  // Layer 5: Data Tier
  const dataBoxes: BoxDef[] = [];

  if (strategy.database) {
    dataBoxes.push({
      label: getDBLabel(strategy.provider),
      sublabel: strategy.database.engine === 'postgresql' ? 'PG' : strategy.database.engine === 'mysql' ? 'MySQL' : strategy.database.engine,
      color: 'magenta',
    });
  }

  if (strategy.cache) {
    dataBoxes.push({
      label: getCacheLabel(strategy.provider),
      sublabel: strategy.cache.engine,
      color: 'cyan',
    });
  }

  if (strategy.queue) {
    dataBoxes.push({
      label: getQueueLabel(strategy.provider),
      sublabel: 'Queue',
      color: 'yellow',
    });
  }

  if (strategy.streaming) {
    dataBoxes.push({
      label: getStreamLabel(strategy.provider),
      sublabel: `${strategy.streaming.shards}sh`,
      color: 'green',
    });
  }

  if (strategy.auth) {
    dataBoxes.push({ label: strategy.auth.service, sublabel: 'Auth', color: 'yellow' });
  }

  if (strategy.objectStorage) {
    dataBoxes.push({ label: strategy.objectStorage.service, sublabel: `${strategy.objectStorage.estimatedGB}GB`, color: 'green' });
  }

  if (strategy.vendorSubscription) {
    const featureLabel = strategy.vendorSubscription.features.slice(0, 3).join('+');
    dataBoxes.push({ label: strategy.vendorSubscription.vendorName, sublabel: featureLabel, color: 'magenta' });
  }

  if (dataBoxes.length > 0) {
    lines.push(connector());
    lines.push(renderDataTier(dataBoxes));
  }

  // Subnet annotation
  lines.push('');
  if (security.network.privateSubnets) {
    lines.push(chalk.dim(`${pad()}  Compute + Data in Private Subnets`));
  }

  // Print all lines
  for (const line of lines) {
    console.log(line);
  }
  console.log('');
}

// --- Helpers ---

interface BoxDef {
  label: string;
  sublabel?: string;
  color: string;
}

const PAD = '  ';
function pad(): string { return PAD; }

function connector(): string {
  return chalk.dim(`${pad()}       │`);
}

function renderBox(label: string, color: string): string[] {
  const colorFn = (chalk as unknown as Record<string, (s: string) => string>)[color] ?? chalk.white;
  const w = Math.max(label.length + 4, 12);
  const top = `┌${'─'.repeat(w)}┐`;
  const mid = `│${centerText(label, w)}│`;
  const bot = `└${'─'.repeat(w)}┘`;
  return [
    chalk.dim(`${pad()}  ${top}`),
    `${pad()}  ${colorFn(mid)}`,
    chalk.dim(`${pad()}  ${bot}`),
  ];
}

function renderHorizontalBoxes(boxes: BoxDef[]): string[] {
  if (boxes.length === 0) return [];
  if (boxes.length === 1) {
    const b = boxes[0]!;
    const lines = renderBox(b.label, b.color);
    if (b.sublabel) {
      // Replace bottom line with sublabel version
      const colorFn = (chalk as unknown as Record<string, (s: string) => string>)[b.color] ?? chalk.white;
      const w = Math.max(b.label.length + 4, 12);
      const sub = `│${centerText(b.sublabel, w)}│`;
      const bot = `└${'─'.repeat(w)}┘`;
      lines.splice(2, 1, `${pad()}  ${colorFn(sub)}`, chalk.dim(`${pad()}  ${bot}`));
    }
    return lines;
  }

  // Multi-box rendering
  const boxWidth = 10;
  const topParts: string[] = [];
  const midParts: string[] = [];
  const subParts: string[] = [];
  const botParts: string[] = [];

  for (const b of boxes) {
    const colorFn = (chalk as unknown as Record<string, (s: string) => string>)[b.color] ?? chalk.white;
    topParts.push(`┌${'─'.repeat(boxWidth)}┐`);
    midParts.push(colorFn(`│${centerText(b.label, boxWidth)}│`));
    subParts.push(colorFn(`│${centerText(b.sublabel ?? '', boxWidth)}│`));
    botParts.push(`└${'─'.repeat(boxWidth)}┘`);
  }

  const gap = '  ';
  return [
    chalk.dim(`${pad()}  ${topParts.join(gap)}`),
    `${pad()}  ${midParts.join(gap)}`,
    `${pad()}  ${subParts.join(gap)}`,
    chalk.dim(`${pad()}  ${botParts.join(gap)}`),
  ];
}

function renderDataTier(boxes: BoxDef[]): string {
  const boxWidth = 10;
  const innerWidth = boxes.length * (boxWidth + 2) + (boxes.length - 1) * 2 + 2;
  const outerWidth = Math.max(innerWidth, 30);

  const lines: string[] = [];
  lines.push(chalk.dim(`${pad()}  ┌${'─'.repeat(outerWidth)}┐`));
  lines.push(chalk.dim(`${pad()}  │`) + chalk.bold.white(centerText('Data Tier', outerWidth)) + chalk.dim('│'));

  // Inner boxes
  const topParts: string[] = [];
  const midParts: string[] = [];
  const subParts: string[] = [];
  const botParts: string[] = [];

  for (const b of boxes) {
    const colorFn = (chalk as unknown as Record<string, (s: string) => string>)[b.color] ?? chalk.white;
    topParts.push(`┌${'─'.repeat(boxWidth)}┐`);
    midParts.push(colorFn(`│${centerText(b.label, boxWidth)}│`));
    subParts.push(colorFn(`│${centerText(b.sublabel ?? '', boxWidth)}│`));
    botParts.push(`└${'─'.repeat(boxWidth)}┘`);
  }

  const gap = ' ';
  const innerContent = (parts: string[]) => {
    const joined = parts.join(gap);
    const remaining = outerWidth - stripAnsi(joined).length;
    const leftPad = Math.max(Math.floor(remaining / 2), 1);
    return ' '.repeat(leftPad) + joined + ' '.repeat(Math.max(remaining - leftPad, 0));
  };

  lines.push(chalk.dim(`${pad()}  │`) + chalk.dim(innerContent(topParts)) + chalk.dim('│'));
  lines.push(chalk.dim(`${pad()}  │`) + innerContent(midParts) + chalk.dim('│'));
  lines.push(chalk.dim(`${pad()}  │`) + innerContent(subParts) + chalk.dim('│'));
  lines.push(chalk.dim(`${pad()}  │`) + chalk.dim(innerContent(botParts)) + chalk.dim('│'));
  lines.push(chalk.dim(`${pad()}  └${'─'.repeat(outerWidth)}┘`));

  return lines.join('\n');
}

function centerText(text: string, width: number): string {
  const len = text.length;
  if (len >= width) return text.slice(0, width);
  const left = Math.floor((width - len) / 2);
  const right = width - len - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

// Cloud-specific label helpers imported from @launchpilot/core
