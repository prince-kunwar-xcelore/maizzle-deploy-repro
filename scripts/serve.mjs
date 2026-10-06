#!/usr/bin/env node
/**
 * Runs the built server so a scenario can be looked at in a browser rather
 * than read off the matrix table.
 *
 * The working directory is a parameter because it changes the outcome on its
 * own: Maizzle resolves `@maizzle/tailwindcss` relative to it at runtime.
 *
 * Usage: node scripts/serve.mjs [--cwd <dir>] [--port <n>] [--hide-deps]
 */
import { spawn } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { outDir, root } from './_shared.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};

const entry = join(outDir, 'server', 'index.mjs');

if (!existsSync(entry)) {
	console.error('No build output. Run `pnpm build` first.');
	process.exit(1);
}

const port = flag('port', '3300');
const cwd = flag('cwd', root);
const deps = join(root, 'node_modules');
const hidden = join(root, 'node_modules.hidden');

// Hiding the install this was built against is what a slim image looks like:
// nothing for Node to find on the way up except what is inside .output.
const hiding = args.includes('--hide-deps');
if (hiding && existsSync(deps)) renameSync(deps, hidden);

const unhide = () => {
	if (hiding && existsSync(hidden)) renameSync(hidden, deps);
};

process.on('exit', unhide);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

console.log(`serving  ${entry}`);
console.log(`cwd      ${cwd}`);
console.log(`deps     ${hiding ? 'hidden (shipped alone)' : 'visible (install above)'}`);
console.log(`open     http://localhost:${port}/\n`);

const server = spawn(process.execPath, [entry], {
	cwd,
	stdio: 'inherit',
	env: { ...process.env, PORT: port, NITRO_PORT: port },
});

server.on('exit', code => process.exit(code ?? 0));
