/**
 * Simulate work with randomized delays for realistic CLI output.
 * In test mode (LAUNCHPILOT_FAST=1), delays are minimal.
 */
export async function simulateWork(
  baseMs: number = 500,
  variance: number = 300,
): Promise<void> {
  if (process.env['LAUNCHPILOT_FAST'] === '1') {
    await sleep(1);
    return;
  }
  const delay = baseMs + Math.random() * variance;
  await sleep(delay);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
