#!/usr/bin/env node
/**
 * Answers the question the "copy in the real packages" Dockerfile raises:
 * how many packages is it, actually?
 *
 * Starts the output in an isolated directory (nothing resolvable above it, the
 * way a slim image looks), reads whichever package Node says is missing,
 * copies that one in from the builder tree, and goes again — until it either
 * starts and renders, or stops making progress.
 *
 * Usage: node scripts/converge.mjs --image <dir> --source <node_modules> [--limit 80]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i === -1 ? fallback : args[i + 1];
};

const image = flag('image', '/tmp/img');
const source = flag('source', '/tmp/flat-builder/node_modules');
const limit = Number(flag('limit', 80));
const modules = join(image, '.output', 'server', 'node_modules');
const entry = join(image, '.output', 'server', 'index.mjs');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Boots the server once and answers with what, if anything, it could not find. */
async function boot(port) {
	const logs = [];
	const server = spawn(process.execPath, [entry], {
		cwd: image,
		env: { ...process.env, PORT: String(port), NITRO_PORT: String(port) },
	});
	server.stdout.on('data', d => logs.push(d.toString()));
	server.stderr.on('data', d => logs.push(d.toString()));

	let started = false;
	for (let i = 0; i < 30; i++) {
		if (server.exitCode !== null) break;
		try { await fetch(`http://127.0.0.1:${port}/`); started = true; break; }
		catch { await sleep(400); }
	}

	let rendered = false, styled = false;
	if (started) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/_internal/render`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ subject: 'Welcome', body: '<p class="text-lg font-bold">Hi Alex</p>' }),
			});
			const payload = await res.text();
			rendered = res.ok && payload.includes('Hi Alex');
			styled = payload.includes('font-weight: 700');
			if (!rendered) logs.push(payload);
		} catch (error) { logs.push(String(error)); }
	}

	server.kill();
	await sleep(150);

	const text = logs.join('');
	// A bare specifier names its package directly. A relative `.node` require is
	// the fallback arm of a runtime platform branch — the package it really
	// wanted is the platform one the tracer did not follow into.
	const named = text.match(/Cannot find (?:package|module) '([^'./][^']*)'/)?.[1]
		// Vite reports its own resolution failures, and they name subpaths of
		// packages the tracer did copy — just not completely.
		?? text.match(/Failed to resolve ([^.\s"']+)/)?.[1]
		?? text.match(/Can't resolve '([^'./][^']*)'/)?.[1];
	const nativeFallback = text.match(/Cannot find module '\.\.\/([a-z0-9-]+)\.([a-z0-9-]+)\.node'/);
	const missing = named ?? (nativeFallback ? `${nativeFallback[1]}-${nativeFallback[2]}` : undefined);

	return { started, rendered, styled, missing, text };
}

const added = [];
const replacedList = [];
const replaced = new Set();

for (let round = 1; round <= limit; round++) {
	const { started, rendered, styled, missing, text } = await boot(3500 + round);

	if (rendered && styled) {
		console.log(`\nround ${round}: starts, renders, styled.`);
		break;
	}

	if (!missing) {
		console.log(`\nround ${round}: stopped on something that is not a missing package.`);
		console.log(`  started=${started} rendered=${rendered} styled=${styled}`);
		console.log(text.split('\n').filter(l => /Error|error/.test(l)).slice(0, 4).join('\n'));
		break;
	}

	// Node names the bare specifier; the package is the first one or two segments.
	const pkg = missing.startsWith('@') ? missing.split('/').slice(0, 2).join('/') : missing.split('/')[0];
	const from = join(source, pkg);

	if (!existsSync(from)) {
		console.log(`\nround ${round}: needs ${pkg}, which the builder tree does not have either.`);
		break;
	}
	// Present but still unresolvable means the traced copy is incomplete, so the
	// whole package is replaced rather than added. Once only — a second ask for
	// the same package means replacing it did not help.
	const present = existsSync(join(modules, pkg));
	if (present && replaced.has(pkg)) {
		console.log(`\nround ${round}: ${pkg} was already replaced and is still unresolvable.`);
		console.log(text.split('\n').filter(l => /Error|error/.test(l)).slice(0, 4).join('\n'));
		break;
	}

	await rm(join(modules, pkg), { recursive: true, force: true });
	await cp(from, join(modules, pkg), { recursive: true, dereference: true });
	(present ? replacedList : added).push(pkg);
	replaced.add(pkg);
	console.log(`round ${String(round).padStart(2)}: ${present ? '~' : '+'} ${pkg}`);
}

console.log(`\nadded ${added.length} package(s) beyond the three: ${added.join(' ') || '(none)'}`);
console.log(`replaced ${replacedList.length} incomplete traced package(s): ${replacedList.join(' ') || '(none)'}`);
