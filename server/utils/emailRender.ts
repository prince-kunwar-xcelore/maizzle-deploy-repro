import { render } from '@maizzle/framework';

export interface RenderInput {
	subject: string;
	body: string;
}

/**
 * The shape the Nuxt docs describe: an SFC string built only from Maizzle's
 * own auto-imported components, with no `components.source` and nothing
 * written to disk.
 */
export async function renderEmail({ subject, body }: RenderInput) {
	const sfc = `<template>
	<Html>
		<Head>
			<style>
				@import "@maizzle/tailwindcss";
			</style>
		</Head>
		<Body class="m-0 bg-slate-200 p-0 font-sans">
			<Container class="mx-auto w-full max-w-[600px] py-6">
				<Heading :level="1" class="text-lg font-bold text-slate-900">${subject}</Heading>
				${body}
			</Container>
		</Body>
	</Html>
</template>`;

	const { html } = await render(sfc);

	if (!/<html[\s>]/i.test(html)) {
		throw new Error('The render produced no document.');
	}

	return { subject, html };
}
