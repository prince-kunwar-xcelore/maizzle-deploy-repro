<script setup>
const props = defineProps({ title: { type: String, default: 'Email' } });
</script>

<template>
	<Html>
		<Head>
			<title>{{ props.title }}</title>
			<Tailwind />
		</Head>
		<Body class="m-0 bg-slate-100 p-0">
			<Container class="bg-white p-8">
				<slot />
			</Container>
		</Body>
	</Html>
</template>
