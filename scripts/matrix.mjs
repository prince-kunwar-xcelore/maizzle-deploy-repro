#!/usr/bin/env node
/**
 * Runs every deployment shape against one build and prints what each does.
 *
 * Hiding the project's node_modules is what simulates shipping the output on
 * its own: Node can no longer walk up into the install it was built against,
 * which is exactly what a slim container image looks like.
 *
 * Usage: node scripts/matrix.mjs            (fast scenarios)
 *        node scripts/matrix.mjs --vendor   (also the self-contained one, slower)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { outDir, requireOutput, root } from './_shared.mjs';

requireOutput();

const withVendor = process.argv.includes('--vendor');
const deps = join(root, 'node_modules');
const hidden = join(root, 'node_modules.hidden');

const script = (name, args = []) =>
	spawnSync(process.execPath, [join(root, 'scripts', name), ...args], { encoding: 'utf8' });

let port = 3220;

function probe({ cwd = root } = {}) {
	const res = script('probe.mjs', ['--cwd', cwd, '--port', String(port++)]);
	const line = (res.stdout || '').split('\n').find(l => l.startsWith('__RESULT__'));
	return line ? JSON.parse(line.slice('__RESULT__'.length)) : { started: false };
}

const hide = () => rename(deps, hidden);
const show = () => rename(hidden, deps);

const rows = [];
const record = (scenario, r) => rows.push({
	scenario,
	starts: r.started ? 'yes' : 'no',
	renders: r.rendered ? 'yes' : 'no',
	styled: r.styled ? 'yes' : 'no',
});

record('as built, install above', probe());
await hide();
record('as built, shipped alone', probe());
await show();

script('strip-traced.mjs');
record('stripped, install above', probe());
await hide();
record('stripped, shipped alone', probe());
await show();
script('restore-traced.mjs');

script('inject-binding.mjs');
await hide();
record('binding added, shipped alone', probe());
await show();

if (withVendor) {
	script('vendor.mjs');
	await hide();
	record('vendored, cwd = project', probe());
	record('vendored, cwd = .output', probe({ cwd: outDir }));
	await show();
}

console.table(rows);

if (!withVendor) console.log('\nRe-run with --vendor to include the self-contained build.');
