import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DetectedExternalService } from '../../../types/index.js';

export interface EnvAnalysisResult {
  externalServices: DetectedExternalService[];
  allVarNames: string[];
}

interface EnvPattern {
  prefix: string;
  provider: string;
  name: string;
  category: DetectedExternalService['category'];
  confidence: number;
}

const ENV_VAR_PATTERNS: EnvPattern[] = [
  { prefix: 'SUPABASE_', provider: 'supabase', name: 'Supabase', category: 'storage', confidence: 0.9 },
  { prefix: 'NEXT_PUBLIC_SUPABASE_', provider: 'supabase', name: 'Supabase', category: 'storage', confidence: 0.9 },
  { prefix: 'FIREBASE_', provider: 'firebase', name: 'Firebase', category: 'storage', confidence: 0.9 },
  { prefix: 'NEXT_PUBLIC_FIREBASE_', provider: 'firebase', name: 'Firebase', category: 'storage', confidence: 0.9 },
  { prefix: 'CLERK_', provider: 'clerk', name: 'Clerk', category: 'auth', confidence: 0.9 },
  { prefix: 'NEXT_PUBLIC_CLERK_', provider: 'clerk', name: 'Clerk', category: 'auth', confidence: 0.9 },
  { prefix: 'AUTH0_', provider: 'auth0', name: 'Auth0', category: 'auth', confidence: 0.9 },
  { prefix: 'NEXTAUTH_', provider: 'nextauth', name: 'NextAuth', category: 'auth', confidence: 0.85 },
  { prefix: 'STRIPE_', provider: 'stripe', name: 'Stripe', category: 'payments', confidence: 0.95 },
  { prefix: 'LEMONSQUEEZY_', provider: 'lemonsqueezy', name: 'LemonSqueezy', category: 'payments', confidence: 0.9 },
  { prefix: 'RESEND_API_KEY', provider: 'resend', name: 'Resend', category: 'email', confidence: 0.9 },
  { prefix: 'SENDGRID_API_KEY', provider: 'sendgrid', name: 'SendGrid', category: 'email', confidence: 0.9 },
  { prefix: 'POSTMARK_', provider: 'postmark', name: 'Postmark', category: 'email', confidence: 0.9 },
  { prefix: 'OPENAI_API_KEY', provider: 'openai', name: 'OpenAI', category: 'ai', confidence: 0.9 },
  { prefix: 'ANTHROPIC_API_KEY', provider: 'anthropic', name: 'Anthropic', category: 'ai', confidence: 0.9 },
  { prefix: 'SENTRY_DSN', provider: 'sentry', name: 'Sentry', category: 'monitoring', confidence: 0.9 },
  { prefix: 'POSTHOG_', provider: 'posthog', name: 'PostHog', category: 'analytics', confidence: 0.85 },
  { prefix: 'NEXT_PUBLIC_POSTHOG_', provider: 'posthog', name: 'PostHog', category: 'analytics', confidence: 0.85 },
  { prefix: 'ALGOLIA_', provider: 'algolia', name: 'Algolia', category: 'search', confidence: 0.9 },
  { prefix: 'AWS_S3_', provider: 'aws-s3', name: 'AWS S3', category: 'storage', confidence: 0.85 },
  { prefix: 'AWS_', provider: 'aws', name: 'AWS', category: 'other', confidence: 0.6 },
  { prefix: 'CLOUDINARY_', provider: 'cloudinary', name: 'Cloudinary', category: 'storage', confidence: 0.9 },
  { prefix: 'UPLOADTHING_', provider: 'uploadthing', name: 'UploadThing', category: 'storage', confidence: 0.9 },
];

const ENV_EXAMPLE_FILES = ['.env.example', '.env.template', '.env.sample'];

export async function analyzeEnvVars(
  repoPath: string,
  subDir?: string,
): Promise<EnvAnalysisResult> {
  const basePath = subDir ? join(repoPath, subDir) : repoPath;
  const varNames = await readEnvExampleFile(basePath);

  if (varNames.length === 0) {
    return { externalServices: [], allVarNames: [] };
  }

  const serviceMap = new Map<string, DetectedExternalService>();

  for (const varName of varNames) {
    for (const pattern of ENV_VAR_PATTERNS) {
      if (varName.startsWith(pattern.prefix) || varName === pattern.prefix) {
        if (!serviceMap.has(pattern.provider)) {
          serviceMap.set(pattern.provider, {
            category: pattern.category,
            provider: pattern.provider,
            name: pattern.name,
            confidence: pattern.confidence,
            envVarHints: [],
          });
        }
        const svc = serviceMap.get(pattern.provider)!;
        if (!svc.envVarHints.includes(varName)) {
          svc.envVarHints.push(varName);
        }
        // Use highest confidence if multiple patterns match the same provider
        svc.confidence = Math.max(svc.confidence, pattern.confidence);
        break; // first matching pattern wins for this var
      }
    }
  }

  return {
    externalServices: [...serviceMap.values()],
    allVarNames: varNames,
  };
}

async function readEnvExampleFile(basePath: string): Promise<string[]> {
  for (const filename of ENV_EXAMPLE_FILES) {
    const filePath = join(basePath, filename);
    if (!existsSync(filePath)) continue;

    try {
      const content = await readFile(filePath, 'utf-8');
      const varNames: string[] = [];

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([A-Z][A-Z0-9_]*)=/);
        if (match?.[1]) {
          varNames.push(match[1]);
        }
      }

      return varNames;
    } catch {
      continue;
    }
  }

  return [];
}
