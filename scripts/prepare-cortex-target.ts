/** Compatibility entry point: current Cortex is always fetched through the saved connection.
 * Prefer: node --import tsx scripts/connect-cortex.ts <snapshot> <application> <environment>
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
const config = z.object({ applicationArchitectureId: z.string().regex(/^[a-f0-9]{64}$/), applicationId: z.string(), environment: z.string(), definitionName: z.string().optional(), architectureDirectory: z.string().optional(), helmBin: z.string().optional() }).parse(JSON.parse(await readFile(process.argv[2], 'utf8')));
if (config.architectureDirectory) process.env.LAUNCHPILOT_ARCHITECTURE_DIR = config.architectureDirectory;
if (config.helmBin) process.env.LAUNCHPILOT_HELM_BIN = config.helmBin;
const imported = await import('../packages/web/src/lib/cortex-connection');
const { prepareConnectedCortexTarget } = (imported as any).default ?? imported;
const result = await prepareConnectedCortexTarget({ applicationArchitectureId: config.applicationArchitectureId, applicationId: config.applicationId, environment: config.environment, definitionName: config.definitionName });
console.log(JSON.stringify({ architectureId: result.graph.id, designId: result.review.design.id, target: result.graph.deploymentTarget, totals: result.review.topology.totals, url: result.url }, null, 2));
