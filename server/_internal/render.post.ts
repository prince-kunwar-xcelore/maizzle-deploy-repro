import { renderEmail } from '../utils/emailRender';

export default defineEventHandler(async (event) => {
	const payload = await readBody<{ subject?: string; body?: string }>(event);

	if (typeof payload?.subject !== 'string' || typeof payload.body !== 'string') {
		throw createError({ statusCode: 400, statusMessage: 'subject and body are required.' });
	}

	try {
		return await renderEmail({ subject: payload.subject, body: payload.body });
	} catch (error) {
		console.error('[render]', error);
		const detail = error instanceof Error ? error.message : String(error);
		throw createError({ statusCode: 422, statusMessage: 'Render failed', message: detail });
	}
});
