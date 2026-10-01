/** Refresh the configured Cortex connection, optionally preparing a deployment.
 * node --import tsx scripts/connect-cortex.ts [application-snapshot-id app env]
 * Fetches and renders only; does not run the AI review or deploy resources.
 */
const imported = await import('../packages/web/src/lib/cortex-connection');
const connector = (imported as any).default ?? imported;
if (process.argv[2]) {
  const result = await connector.prepareConnectedCortexTarget({ applicationArchitectureId: process.argv[2], applicationId: process.argv[3], environment: process.argv[4] });
  console.log(JSON.stringify({ architectureId: result.graph.id, designId: result.review.design.id, target: result.graph.deploymentTarget, workloads: result.review.topology.workloads.length, totals: result.review.topology.totals, url: result.url }, null, 2));
} else {
  const { connection } = await connector.syncCortexConnection();
  console.log(JSON.stringify({ repoUrl: connection.repoUrl, ref: connection.ref, revision: connection.revision, checkedAt: connection.checkedAt, environments: [...new Set(connection.definitions.map((d: any) => d.environment))], registeredDefinitions: connection.definitions.length }, null, 2));
}
