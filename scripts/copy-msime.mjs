import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = dirname(require.resolve('@msime/web-engine/package.json'));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const target = resolve('public/msime');

rmSync(target, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [join(root, 'bin/msime-web-engine.mjs'), 'copy', join(target, version), '--no-wubi', '--no-japanese', '--no-model', '--no-helpcode'],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
console.log(`@msime/web-engine ${version} -> public/msime/${version}`);
