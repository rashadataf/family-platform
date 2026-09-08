import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { envSchema } from '../apps/api/src/config/env.schema.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const envExamplePath = new URL('../.env.example', import.meta.url);

/**
 * One-directional check: every key the API's env schema requires must
 * appear in the committed .env.example template. The reverse isn't checked
 * — POSTGRES_* keys used only by docker-compose.yml legitimately don't need
 * to be in the API's own schema.
 */
export function findMissingKeys(): string[] {
  const templateContent = readFileSync(envExamplePath, 'utf-8');
  const templateKeys = new Set(Object.keys(dotenv.parse(templateContent)));
  const schemaKeys = Object.keys(envSchema.shape);

  return schemaKeys.filter((key) => !templateKeys.has(key));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const missing = findMissingKeys();
  if (missing.length > 0) {
    console.error(
      `.env.example is missing keys required by the API's env schema: ${missing.join(', ')}`,
    );
    console.error(`(checked against ${repoRoot})`);
    process.exit(1);
  }
  console.log('.env.example is in sync with the API env schema.');
}
