<script setup>
const props = defineProps({ user: { type: String, default: 'there' } });
</script>

<template>
	<Html>
		<Head>
			<style>
				@import "@maizzle/tailwindcss";
			</style>
		</Head>
		<Body class="m-0 bg-slate-200 p-0 font-sans">
			<Container class="mx-auto w-full max-w-[600px] py-6">
				<table class="w-full bg-white" role="presentation">
					<tr>
						<td class="px-8 py-8">
							<p class="m-0 text-lg font-bold text-slate-900">Hello, {{ props.user }}!</p>
							<p class="m-0 mt-2 text-slate-700">A build-time template from the module.</p>
						</td>
					</tr>
				</table>
			</Container>
		</Body>
	</Html>
</template>
