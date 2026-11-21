// Fails when the project or any declared dependency is not under a lenient license.
import { readFileSync, existsSync } from 'node:fs';

const ALLOWED = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Apache-2.0', '0BSD', 'CC0-1.0', 'Unlicense']);
const problems = [];

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.license !== 'MIT') problems.push(`package.json license is ${pkg.license}, expected MIT`);
if (!existsSync('LICENSE') || !readFileSync('LICENSE', 'utf8').startsWith('MIT License')) {
  problems.push('LICENSE is missing or is not the MIT license');
}

const deps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const name of Object.keys(deps)) {
  const file = `node_modules/${name}/package.json`;
  if (!existsSync(file)) { problems.push(`${name}: declared but not installed, license unknown`); continue; }
  const lic = JSON.parse(readFileSync(file, 'utf8')).license;
  if (!ALLOWED.has(lic)) problems.push(`${name}: license ${lic} is not allowed`);
}

if (problems.length) { console.error('license-check failed:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log(`license-check ok (${Object.keys(deps).length} dependencies)`);
