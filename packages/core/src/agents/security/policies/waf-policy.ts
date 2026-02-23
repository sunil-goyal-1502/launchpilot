import { WAFPolicy, WAFRule, SecurityTier } from '../../../types/index';

const OWASP_RULES: WAFRule[] = [
  { id: 'WAF-001', name: 'SQL Injection', description: 'Block SQL injection attempts', priority: 1, action: 'block' },
  { id: 'WAF-002', name: 'XSS Protection', description: 'Block cross-site scripting attacks', priority: 2, action: 'block' },
  { id: 'WAF-003', name: 'Path Traversal', description: 'Block path traversal attacks', priority: 3, action: 'block' },
  { id: 'WAF-004', name: 'Command Injection', description: 'Block OS command injection', priority: 4, action: 'block' },
  { id: 'WAF-005', name: 'CSRF Protection', description: 'Block cross-site request forgery', priority: 5, action: 'block' },
  { id: 'WAF-006', name: 'File Upload Validation', description: 'Restrict malicious file uploads', priority: 6, action: 'block' },
  { id: 'WAF-007', name: 'XML External Entity', description: 'Block XXE attacks', priority: 7, action: 'block' },
  { id: 'WAF-008', name: 'Server-Side Request Forgery', description: 'Block SSRF attempts', priority: 8, action: 'block' },
  { id: 'WAF-009', name: 'Broken Auth Patterns', description: 'Detect auth bypass patterns', priority: 9, action: 'count' },
  { id: 'WAF-010', name: 'Known Bad Inputs', description: 'Block known malicious payloads', priority: 10, action: 'block' },
];

const RATE_LIMITS: Record<SecurityTier, number> = {
  basic: 1000,
  standard: 500,
  advanced: 200,
};

export function generateWAFPolicy(tier: SecurityTier): WAFPolicy {
  const ruleCount = tier === 'basic' ? 3 : tier === 'standard' ? 6 : 10;

  return {
    enabled: tier !== 'basic',
    rules: OWASP_RULES.slice(0, ruleCount),
    rateLimitRpm: RATE_LIMITS[tier],
  };
}
