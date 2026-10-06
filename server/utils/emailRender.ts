import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { render } from '@maizzle/framework';

/**
 * Where the layouts are written so Maizzle can scan for them. Anchored to the
 * working directory rather than the temp directory: Maizzle compiles through a
 * Vite server rooted at process.cwd(), and on Windows a temp dir on another
 * drive leaves the layout unresolved and the render a bare doctype.
 */
function componentCacheRoot(): string {
	return join(process.cwd(), '.email-components');
}

/** Writes the bundled layouts out and answers with the directory holding them. */
async function materialiseComponents(): Promise<string> {
	const storage = useStorage('assets:emailLayouts');
	const keys = await storage.getKeys();

	const sources = await Promise.all(
		keys.map(async key => [key, (await storage.getItem<string>(key)) ?? ''] as const),
	);

	const hash = createHash('sha1')
		.update(sources.map(([k, s]) => `${k}\u0000${s}`).join('\u0000'))
		.digest('hex')
		.slice(0, 12);

	const dir = join(componentCacheRoot(), hash).replace(/\\/g, '/');
	await mkdir(dir, { recursive: true });

	await Promise.all(sources.map(async ([key, source]) => {
		const pending = join(dir, `${key}.${process.pid}.${randomUUID()}.tmp`);
		await writeFile(pending, source, 'utf8');
		await rename(pending, join(dir, key));
	}));

	return dir;
}

export interface RenderInput {
	subject: string;
	body: string;
}

export async function renderEmail({ subject, body }: RenderInput) {
	const componentDir = await materialiseComponents();

	const sfc = `<template><Default title="${subject}">${body}</Default></template>`;

	const { html } = await render(sfc, {
		components: { source: [componentDir] },
	});

	// An unresolved layout renders as nothing at all, leaving output that is only
	// the doctype. Fail here rather than mail an empty document.
	if (!/<html[\s>]/i.test(html)) {
		throw new Error('The <Default> layout did not resolve, so the render produced no document.');
	}

	return { subject, html };
}
