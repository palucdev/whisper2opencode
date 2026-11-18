import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.join(__dirname, '..'); // Points to dist/ where agents are copied

const UNKNOWN_VERSION = 'unknown';

export const parsePluginVersion = (rawPackageJson: string): string => {
  try {
    const version = (JSON.parse(rawPackageJson) as { version?: unknown }).version;
    return typeof version === 'string' && version.length > 0 ? version : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
};

export const readPluginVersion = (): string => {
  try {
    const packageJsonPath = path.join(PLUGIN_ROOT, '..', 'package.json');
    return parsePluginVersion(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return UNKNOWN_VERSION;
  }
};

export const PLUGIN_VERSION = readPluginVersion();
