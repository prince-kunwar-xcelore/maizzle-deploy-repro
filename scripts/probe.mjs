#!/usr/bin/env node
/**
 * Starts the built server and asks it to render one email.
 *
 * Checks three things, because the interesting failures are not all crashes:
 * whether the server starts at all, whether the render answers, and whether the
 * answer carries inline styles. An unresolvable Tailwind still returns 200 with
 * a well-formed but entirely unstyled document.
 *
 * Usage: node scripts/probe.mjs [--cwd <dir>] [--port <n>]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { outDir, root } from './_shared.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};

const port = Number(flag('port', 3199));
const cwd = flag('cwd', root);
const out = flag('out', outDir);
const entry = join(out, 'server', 'index.mjs');

if (!existsSync(entry)) {
	console.error('No build output. Run `pnpm build` first.');
	process.exit(1);
}

const logs = [];
const server = spawn(process.execPath, [entry], {
	cwd,
	env: { ...process.env, PORT: String(port), NITRO_PORT: String(port) },
});

server.stdout.on('data', d => logs.push(d.toString()));
server.stderr.on('data', d => logs.push(d.toString()));

const sleep = ms => new Promise(r => setTimeout(r, ms));

let started = false;
for (let i = 0; i < 40; i++) {
	if (server.exitCode !== null) break;
	try {
		await fetch(`http://127.0.0.1:${port}/`);
		started = true;
		break;
	} catch { await sleep(500); }
}

const report = { cwd, out, started, rendered: false, styled: false, status: null, error: null };

if (started) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/_internal/render`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ subject: 'Welcome', body: '<p class="text-lg font-bold">Hi Alex</p>' }),
		});

		report.status = res.status;
		const payload = await res.text();
		report.rendered = res.ok && payload.includes('Hi Alex');
		// Tailwind inlines its rules as style attributes; none means it never ran.
		report.styled = payload.includes('style=');
		if (!res.ok) report.error = payload.slice(0, 300);
	} catch (error) {
		report.error = String(error);
	}
} else {
	report.error = logs.join('').split('\n').filter(l => /Error|Cannot find/.test(l)).slice(0, 3).join('\n')
		|| logs.join('').slice(-300);
}

server.kill();
await sleep(200);

const mark = ok => (ok ? 'yes' : 'NO');
console.log(`  server started : ${mark(report.started)}`);
console.log(`  render ok      : ${mark(report.rendered)}${report.status ? ` (HTTP ${report.status})` : ''}`);
console.log(`  styles inlined : ${mark(report.styled)}`);
if (report.error) console.log(`  note           : ${report.error.split('\n')[0].slice(0, 160)}`);

console.log(`\n__RESULT__${JSON.stringify(report)}`);
process.exit(report.rendered && report.styled ? 0 : 1);
