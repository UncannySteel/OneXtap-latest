// GENERATE_IMPROVED_ANSWER { data: { token, ...body } } → { text }
//   — proxies POST /api/answer-vault/generate
//
// Since 1.0.2. Accepted from the popup only: no website has sent it (main's
// src/ never did), so the site cannot spend through the worker.
//
// `token` is the caller's Supabase JWT, sent as the header and never in the
// body; the worker holds no session of its own.

export default {
  kind: 'GENERATE_IMPROVED_ANSWER',
  from: ['popup'],

  async handle(msg, { fetch, apiUrl, log }) {
    const payload = msg.data || {};
    const { token, ...body } = payload;
    try {
      const res = await fetch(`${apiUrl}/api/answer-vault/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify(body),
      });
      const respBody = await res.json();
      if (res.ok) {
        return { success: true, text: respBody.text || respBody.answer || '' };
      }
      log.error('answer generation rejected by server', {
        status: res.status,
        requestId: res.headers.get('X-Request-Id'),
      });
      return {
        success: false,
        error: respBody.error || `Generation failed (${res.status})`,
      };
    } catch (err) {
      log.error('answer generation request failed', err, { api: apiUrl });
      return { success: false, error: err.message };
    }
  },
};
