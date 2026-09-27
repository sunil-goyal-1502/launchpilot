import { Pool } from 'pg';
import { createClient } from 'redis';
import { SecretClient } from '@azure/keyvault-secrets';
const databaseUrl = process.env.DATABASE_URL;
export const db = new Pool({ connectionString: databaseUrl });
export const cache = createClient({ url: process.env.REDIS_URL });
export const vaultUrl = process.env.KEY_VAULT_URL;
// process.env.FAKE_COMMENT must never be reported as an environment read.
const example = 'process.env.FAKE_STRING';
