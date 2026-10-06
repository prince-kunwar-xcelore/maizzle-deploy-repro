<script setup lang="ts">
const subject = ref('Welcome aboard');
const body = ref('<p class="text-lg font-bold text-slate-900">Hi Alex</p>\n<p class="mt-2 text-slate-600">Thanks for signing up.</p>');

const html = ref('');
const error = ref('');
const pending = ref(false);
const took = ref(0);

/**
 * Whether Tailwind actually ran. Maizzle inlines its rules as style
 * attributes, so a render that resolves the layout but never resolves
 * `@maizzle/tailwindcss` comes back as a complete document with none — the
 * failure this repro exists to make visible.
 */
const styled = computed(() => html.value.includes('font-weight: 700'));

async function render() {
	pending.value = true;
	error.value = '';
	const started = performance.now();

	try {
		const result = await $fetch<{ html: string }>('/_internal/render', {
			method: 'POST',
			body: { subject: subject.value, body: body.value },
		});
		html.value = result.html;
	} catch (e: any) {
		error.value = e?.data?.message ?? e?.message ?? String(e);
		html.value = '';
	} finally {
		took.value = Math.round(performance.now() - started);
		pending.value = false;
	}
}

onMounted(render);
</script>

<template>
	<main class="page">
		<header>
			<h1>maizzle deploy repro</h1>
			<p>Renders on demand through <code>POST /_internal/render</code>. Watch the badges, not just the preview.</p>
		</header>

		<section class="status">
			<span class="badge" :class="html ? 'ok' : 'bad'">render {{ html ? 'ok' : 'failed' }}</span>
			<span class="badge" :class="styled ? 'ok' : 'bad'">styles {{ styled ? 'inlined' : 'missing' }}</span>
			<span class="badge muted">{{ took }} ms</span>
			<span class="badge muted">{{ html.length.toLocaleString() }} bytes</span>
		</section>

		<p v-if="html && !styled" class="warn">
			The document rendered but carries no inline styles. Maizzle resolves
			<code>@maizzle/tailwindcss</code> at runtime relative to the working directory,
			so this is what an unstyled email looks like when that lookup fails — a
			success as far as the caller is concerned.
		</p>

		<pre v-if="error" class="error">{{ error }}</pre>

		<div class="split">
			<div class="pane">
				<label for="subject">Subject</label>
				<input id="subject" v-model="subject">

				<label for="body">Body (Vue + Tailwind classes)</label>
				<textarea id="body" v-model="body" spellcheck="false" />

				<button :disabled="pending" @click="render">
					{{ pending ? 'Rendering…' : 'Render' }}
				</button>
			</div>

			<div class="pane">
				<label>Preview</label>
				<!-- No allow-scripts: the rendered document is untrusted input here. -->
				<iframe :srcdoc="html" sandbox="allow-same-origin" title="Email preview" />

				<details>
					<summary>Rendered HTML</summary>
					<pre>{{ html }}</pre>
				</details>
			</div>
		</div>
	</main>
</template>

<style>
* { box-sizing: border-box; }
body { margin: 0; background: #f8fafc; color: #0f172a; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
.page { max-width: 1100px; margin: 0 auto; padding: 24px; }
h1 { margin: 0 0 4px; font-size: 20px; }
header p { margin: 0 0 16px; color: #64748b; }
code { background: #e2e8f0; border-radius: 4px; padding: 1px 5px; font-size: 12px; }
.status { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.badge { border-radius: 999px; padding: 3px 10px; font-size: 12px; font-weight: 600; }
.badge.ok { background: #dcfce7; color: #166534; }
.badge.bad { background: #fee2e2; color: #991b1b; }
.badge.muted { background: #e2e8f0; color: #475569; }
.warn { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 10px 12px; color: #78350f; }
.error { background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 10px 12px; color: #7f1d1d; white-space: pre-wrap; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
.pane { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; }
label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin: 8px 0 4px; }
input, textarea { width: 100%; font: 13px ui-monospace, monospace; padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; }
textarea { min-height: 200px; resize: vertical; }
button { margin-top: 12px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; padding: 9px 16px; font-weight: 600; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
iframe { width: 100%; height: 420px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; }
details { margin-top: 10px; }
summary { cursor: pointer; font-size: 12px; color: #475569; }
details pre { max-height: 220px; overflow: auto; background: #f1f5f9; border-radius: 6px; padding: 10px; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
@media (max-width: 900px) { .split { grid-template-columns: 1fr; } }
</style>
