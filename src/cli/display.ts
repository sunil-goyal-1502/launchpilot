import chalk from 'chalk';
import Table from 'cli-table3';
import boxen from 'boxen';
import { ApplicationBlueprint, ScalingStrategy, SecurityPolicy, DeployResult, AIAnalysis } from '../types/index.js';

export function showBanner(): void {
  const banner = boxen(
    chalk.bold.cyan('LaunchPilot') + chalk.dim(' v0.1.0') + '\n' +
    chalk.white('Deploy vibe-coded apps to production infrastructure'),
    {
      padding: 1,
      margin: { top: 1, bottom: 1, left: 0, right: 0 },
      borderStyle: 'round',
      borderColor: 'cyan',
    }
  );
  console.log(banner);
}

export function showBlueprint(blueprint: ApplicationBlueprint): void {
  console.log('');
  console.log(chalk.bold.white('  Application Blueprint'));
  console.log(chalk.dim(`  ${'─'.repeat(45)}`));

  const table = new Table({
    chars: { top: '', 'top-mid': '', 'top-left': '', 'top-right': '', bottom: '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '', left: '  ', 'left-mid': '', mid: '', 'mid-mid': '', right: '', 'right-mid': '' },
    style: { 'padding-left': 1, 'padding-right': 2 },
  });

  table.push(
    [chalk.dim('Repository'), chalk.white(blueprint.repoName)],
    [chalk.dim('Runtime'), chalk.yellow(blueprint.runtime)],
    [chalk.dim('App Type'), chalk.yellow(blueprint.appType)],
    [chalk.dim('Frameworks'), blueprint.frameworks.map(f => chalk.green(f.name)).join(', ') || chalk.dim('none')],
    [chalk.dim('Databases'), blueprint.databases.map(d => chalk.magenta(d.name)).join(', ') || chalk.dim('none')],
    [chalk.dim('Services'), blueprint.services.map(s => chalk.cyan(`${s.name} (${s.serviceType})`)).join(', ') || chalk.dim('none')],
    [chalk.dim('Docker'), blueprint.hasDockerfile ? chalk.green('Yes') : chalk.dim('No')],
    [chalk.dim('Complexity'), complexityBadge(blueprint.complexity)],
  );

  if (blueprint.envVars.length > 0) {
    table.push([chalk.dim('Env Vars'), chalk.dim(blueprint.envVars.slice(0, 5).join(', ') + (blueprint.envVars.length > 5 ? ` +${blueprint.envVars.length - 5} more` : ''))]);
  }

  if (blueprint.baas?.providers && blueprint.baas.providers.length > 0) {
    table.push([chalk.dim('BaaS'), blueprint.baas.providers.map(b => chalk.magenta(`${b.name} (${b.features.join(', ')})`)).join(', ')]);
  }
  if (blueprint.baas?.platformConfigs && blueprint.baas.platformConfigs.length > 0) {
    table.push([chalk.dim('Deploy Target'), blueprint.baas.platformConfigs.map(p => chalk.cyan(p.target)).join(', ')]);
  }
  if (blueprint.baas?.externalServices && blueprint.baas.externalServices.length > 0) {
    table.push([chalk.dim('Ext. Services'), blueprint.baas.externalServices.map(s => chalk.blue(`${s.name} (${s.category})`)).join(', ')]);
  }
  if (blueprint.baas?.migrations && blueprint.baas.migrations.length > 0) {
    const totalTables = blueprint.baas.migrations.reduce((sum, m) => sum + m.tables.length, 0);
    table.push([chalk.dim('DB Schema'), chalk.white(`${totalTables} tables from ${blueprint.baas.migrations.length} migrations`)]);
  }

  console.log(table.toString());

  // Show monorepo components if present
  if (blueprint.components && blueprint.components.length > 0) {
    console.log('');
    console.log(chalk.bold.white('  Components'));
    console.log(chalk.dim(`  ${'─'.repeat(45)}`));
    for (const comp of blueprint.components) {
      const frameworks = comp.frameworks.length > 0
        ? chalk.dim(` (${comp.frameworks.join(', ')})`)
        : '';
      console.log(`  ${chalk.white(comp.path.padEnd(16))} ${chalk.yellow(comp.runtime)}${frameworks}`);
    }
  }

  console.log('');
}

export function showStrategyComparison(strategies: ScalingStrategy[]): void {
  console.log('');
  console.log(chalk.bold.white('  Scaling Strategies'));
  console.log(chalk.dim(`  ${'─'.repeat(45)}`));

  const table = new Table({
    head: ['', ...strategies.map(s => chalk.bold(tierBadge(s.tier) + ' ' + s.name))],
    style: { head: [], 'padding-left': 1, 'padding-right': 1 },
  });

  table.push(
    [chalk.dim('Compute'), ...strategies.map(s => `${s.compute.instanceType} x${s.compute.count}`)],
    [chalk.dim('vCPUs'), ...strategies.map(s => `${s.compute.vCPUs * s.compute.count}`)],
    [chalk.dim('Memory'), ...strategies.map(s => `${s.compute.memoryGB * s.compute.count} GB`)],
    [chalk.dim('Auto Scale'), ...strategies.map(s => s.compute.autoScaling ? chalk.green('Yes') + chalk.dim(` (${s.compute.minInstances}-${s.compute.maxInstances})`) : chalk.dim('No'))],
  );

  if (strategies.some(s => s.database)) {
    table.push(
      [chalk.dim('Database'), ...strategies.map(s => s.database?.instanceType ?? chalk.dim('none'))],
      [chalk.dim('Multi-AZ'), ...strategies.map(s => s.database?.multiAZ ? chalk.green('Yes') : chalk.dim('No'))],
      [chalk.dim('Read Replicas'), ...strategies.map(s => String(s.database?.readReplicas ?? 0))],
    );
  }

  if (strategies.some(s => s.cache)) {
    table.push(
      [chalk.dim('Cache'), ...strategies.map(s => s.cache ? chalk.cyan(`${s.cache.service} ${s.cache.nodeType} x${s.cache.nodes}`) : chalk.dim('none'))],
    );
  }

  if (strategies.some(s => s.queue)) {
    table.push(
      [chalk.dim('Queue'), ...strategies.map(s => s.queue ? chalk.cyan(`${s.queue.service} (${s.queue.type})`) : chalk.dim('none'))],
    );
  }

  if (strategies.some(s => s.streaming)) {
    table.push(
      [chalk.dim('Streaming'), ...strategies.map(s => s.streaming ? chalk.cyan(`${s.streaming.service} (${s.streaming.shards} shards)`) : chalk.dim('none'))],
    );
  }

  if (strategies.some(s => s.auth)) {
    table.push([chalk.dim('Auth'), ...strategies.map(s => s.auth ? chalk.cyan(s.auth.service) : chalk.dim('none'))]);
  }
  if (strategies.some(s => s.objectStorage)) {
    table.push([chalk.dim('Storage'), ...strategies.map(s => s.objectStorage ? chalk.cyan(`${s.objectStorage.service} (${s.objectStorage.estimatedGB}GB)`) : chalk.dim('none'))]);
  }

  table.push(
    [chalk.dim('Load Balancer'), ...strategies.map(s => s.network.loadBalancer ? chalk.green('Yes') : chalk.dim('No'))],
    [chalk.dim('CDN'), ...strategies.map(s => s.network.cdn ? chalk.green('Yes') : chalk.dim('No'))],
    [chalk.dim('WAF'), ...strategies.map(s => s.network.waf ? chalk.green('Yes') : chalk.dim('No'))],
    [chalk.dim('Est. Users'), ...strategies.map(s => s.estimatedUsers)],
  );

  // Cost row
  if (strategies.some(s => s.costBreakdown)) {
    table.push(
      [chalk.bold('Monthly Cost'), ...strategies.map(s =>
        s.costBreakdown ? chalk.bold.green(`$${s.costBreakdown.total.toFixed(2)}/mo`) : chalk.dim('N/A')
      )],
    );
  }

  console.log(table.toString());
  console.log('');
}

export function showSecuritySummary(policy: SecurityPolicy): void {
  console.log('');
  console.log(chalk.bold.white('  Security Policy'));
  console.log(chalk.dim(`  ${'─'.repeat(45)}`));

  const table = new Table({
    chars: { top: '', 'top-mid': '', 'top-left': '', 'top-right': '', bottom: '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '', left: '  ', 'left-mid': '', mid: '', 'mid-mid': '', right: '', 'right-mid': '' },
    style: { 'padding-left': 1, 'padding-right': 2 },
  });

  table.push(
    [chalk.dim('Security Tier'), securityBadge(policy.tier)],
    [chalk.dim('WAF Enabled'), policy.waf.enabled ? chalk.green('Yes') + chalk.dim(` (${policy.waf.rules.length} rules)`) : chalk.dim('No')],
    [chalk.dim('Rate Limit'), `${policy.waf.rateLimitRpm} req/min`],
    [chalk.dim('TLS Version'), chalk.white(`>= ${policy.tls.minVersion}`)],
    [chalk.dim('HSTS'), policy.tls.hstsEnabled ? chalk.green('Enabled') : chalk.dim('Disabled')],
    [chalk.dim('VPC'), policy.network.vpcEnabled ? chalk.green('Yes') : chalk.dim('No')],
    [chalk.dim('Private Subnets'), policy.network.privateSubnets ? chalk.green('Yes') : chalk.dim('No')],
    [chalk.dim('Flow Logging'), policy.network.flowLogging ? chalk.green('Yes') : chalk.dim('No')],
    [chalk.dim('Secrets Manager'), chalk.white(policy.secrets.provider)],
    [chalk.dim('Secret Rotation'), policy.secrets.rotationEnabled ? chalk.green(`Every ${policy.secrets.rotationDays} days`) : chalk.dim('Disabled')],
  );

  console.log(table.toString());

  if (policy.vulnerabilities.length > 0) {
    console.log('');
    console.log(chalk.bold.yellow(`  Vulnerabilities Found (${policy.vulnerabilities.length})`));
    for (const vuln of policy.vulnerabilities) {
      const sevColor = vuln.severity === 'critical' ? chalk.red : vuln.severity === 'high' ? chalk.red : vuln.severity === 'medium' ? chalk.yellow : chalk.dim;
      console.log(`  ${sevColor(`[${vuln.severity.toUpperCase()}]`)} ${vuln.package}: ${vuln.description}`);
      console.log(chalk.dim(`    → ${vuln.recommendation}`));
    }
  }

  console.log('');
}

export function showDeploymentResult(result: DeployResult): void {
  console.log('');

  if (result.success) {
    const successBox = boxen(
      chalk.bold.green('Deployment Successful!') + '\n\n' +
      chalk.dim('Deployment ID: ') + chalk.white(result.deploymentId) + '\n' +
      chalk.dim('Provider:      ') + chalk.white(result.provider.toUpperCase()) + '\n' +
      chalk.dim('Duration:      ') + chalk.white(`${(result.totalDuration / 1000).toFixed(1)}s`) + '\n' +
      chalk.dim('Resources:     ') + chalk.white(`${result.resources.length} created`) + '\n\n' +
      chalk.dim('App URL:       ') + chalk.cyan.underline(result.url) + '\n' +
      chalk.dim('Dashboard:     ') + chalk.cyan.underline(result.dashboardUrl),
      {
        padding: 1,
        margin: { top: 0, bottom: 1, left: 2, right: 0 },
        borderStyle: 'round',
        borderColor: 'green',
      }
    );
    console.log(successBox);
  } else {
    const failedCheckpoint = result.checkpoints.find(c => c.status === 'failed');
    const failBox = boxen(
      chalk.bold.red('Deployment Failed') + '\n\n' +
      chalk.dim('Failed at: ') + chalk.white(failedCheckpoint?.name ?? 'unknown') + '\n' +
      chalk.dim('Error:     ') + chalk.red(failedCheckpoint?.error ?? 'Unknown error'),
      {
        padding: 1,
        margin: { top: 0, bottom: 1, left: 2, right: 0 },
        borderStyle: 'round',
        borderColor: 'red',
      }
    );
    console.log(failBox);
  }

  // Show checkpoint summary
  console.log(chalk.bold.white('  Deployment Checkpoints'));
  for (const cp of result.checkpoints) {
    const icon = cp.status === 'completed' ? chalk.green('✓') :
                 cp.status === 'failed' ? chalk.red('✗') :
                 cp.status === 'skipped' ? chalk.dim('○') :
                 chalk.yellow('…');
    console.log(`  ${icon} ${cp.name}`);
    if (cp.output) console.log(chalk.dim(`    ${cp.output}`));
    if (cp.error) console.log(chalk.red(`    ${cp.error}`));
  }
  console.log('');
}

export function showAIAnalysis(analysis: AIAnalysis): void {
  console.log('');
  console.log(chalk.bold.white('  AI Deep Analysis'));
  console.log(chalk.dim(`  ${'─'.repeat(45)}`));

  // App purpose
  console.log('');
  console.log(chalk.dim('  Purpose'));
  console.log(`  ${analysis.appPurpose}`);

  // Architecture
  console.log('');
  console.log(chalk.dim('  Architecture'));
  console.log(`  ${chalk.yellow(analysis.architecturePattern)}`);

  // API Routes
  if (analysis.apiRoutes.length > 0) {
    console.log('');
    console.log(chalk.dim('  API Routes'));
    const routeTable = new Table({
      head: ['Method', 'Path', 'Handler', 'Description'].map(h => chalk.dim(h)),
      style: { head: [], 'padding-left': 1, 'padding-right': 1 },
    });
    for (const route of analysis.apiRoutes.slice(0, 15)) {
      routeTable.push([
        chalk.green(route.method),
        chalk.white(route.path),
        chalk.dim(route.handler),
        chalk.dim(route.description ?? ''),
      ]);
    }
    console.log(routeTable.toString());
    if (analysis.apiRoutes.length > 15) {
      console.log(chalk.dim(`  ... and ${analysis.apiRoutes.length - 15} more routes`));
    }
  }

  // Data Flow
  if (analysis.dataFlow.length > 0) {
    console.log('');
    console.log(chalk.dim('  Data Flow'));
    for (const step of analysis.dataFlow) {
      console.log(`  ${chalk.cyan(step.from)} ${chalk.dim('→')} ${chalk.cyan(step.to)}: ${step.description}`);
    }
  }

  // Security Concerns
  if (analysis.securityConcerns.length > 0) {
    console.log('');
    console.log(chalk.bold.yellow(`  Security Concerns (${analysis.securityConcerns.length})`));
    for (const concern of analysis.securityConcerns) {
      const sevColor = concern.severity === 'critical' ? chalk.red :
                       concern.severity === 'high' ? chalk.red :
                       concern.severity === 'medium' ? chalk.yellow : chalk.dim;
      console.log(`  ${sevColor(`[${concern.severity.toUpperCase()}]`)} ${concern.category}: ${concern.description}`);
      if (concern.file) console.log(chalk.dim(`    File: ${concern.file}`));
      console.log(chalk.dim(`    → ${concern.recommendation}`));
    }
  }

  // Deployment Recommendations
  if (analysis.deploymentRecommendations.length > 0) {
    console.log('');
    console.log(chalk.dim('  Deployment Recommendations'));
    for (const rec of analysis.deploymentRecommendations) {
      console.log(`  ${chalk.green('•')} ${rec}`);
    }
  }

  // Token usage
  console.log('');
  console.log(chalk.dim(`  AI Stats: ${analysis.analyzedFiles} files, ${analysis.totalChunks} chunks`));
  console.log(chalk.dim(`  Tokens: ${analysis.tokenUsage.inputTokens} in / ${analysis.tokenUsage.outputTokens} out (~$${analysis.tokenUsage.estimatedCostUSD.toFixed(4)})`));
  console.log('');
}

function complexityBadge(c: string): string {
  return c === 'high' ? chalk.red('HIGH') : c === 'medium' ? chalk.yellow('MEDIUM') : chalk.green('LOW');
}

function tierBadge(t: string): string {
  return t === 'high' ? chalk.magenta('▲') : t === 'medium' ? chalk.yellow('●') : chalk.green('○');
}

function securityBadge(t: string): string {
  return t === 'advanced' ? chalk.green('ADVANCED') : t === 'standard' ? chalk.yellow('STANDARD') : chalk.dim('BASIC');
}
