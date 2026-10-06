<script setup>
const props = defineProps({ title: { type: String, default: 'Email' } });
</script>

<template>
	<Html lang="en" dir="ltr">
		<!--
			The Tailwind entry has to be literal markup. Maizzle decides whether to
			run the Tailwind compiler by looking for the `@maizzle/tailwindcss`
			specifier in the rendered style block, and an interpolated `{{ }}`
			string does not match, so the step is skipped and the email goes out
			unstyled. This is also the import that is resolved at runtime against
			the working directory rather than through the bundle.
		-->
		<Head>
			<title>{{ props.title }}</title>
			<style>
				@import "@maizzle/tailwindcss";
			</style>
		</Head>

		<Body class="m-0 bg-slate-100 p-0 font-sans">
			<Container class="mx-auto w-full max-w-[600px] rounded-lg bg-white p-8">
				<slot />
			</Container>
		</Body>
	</Html>
</template>
