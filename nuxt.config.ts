import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineNuxtConfig } from 'nuxt/config';

const here = dirname(fileURLToPath(import.meta.url));
const fromHere = (...s: string[]) => join(here, ...s).replace(/\\/g, '/');

export default defineNuxtConfig({
	compatibilityDate: '2025-07-15',

	// The official module, registered exactly as the docs prescribe.
	modules: ['@maizzle/nuxt'],

	nitro: {
		// Maizzle is a build tool, not a leaf library: it starts a Vite SSR server
		// per render. Bundling it produces a server that cannot load its own
		// native pieces, so it is imported at runtime instead.
		externals: {
			external: ['@maizzle/framework', '@maizzle/tailwindcss'],
		},

		// Maizzle resolves components by scanning a directory, and the server
		// bundle has none. The layouts ride along as server assets and are written
		// back out before the first render.
		serverAssets: [{ baseName: 'emailLayouts', dir: fromHere('server/utils/layouts') }],

		handlers: [
			{ route: '/_internal/render', method: 'post', handler: fromHere('server/_internal/render.post.ts') },
		],
	},
});
