// PARSE_RESUME { data: { fileData, fileName, fileType, token } }
//   → { data, text } — proxies POST /api/parse-resume
//
// Kept for old websites only. Since 1.0.2; today's production website sends
// it, and from this release on src/resumeParse.js calls the API itself on
// every surface, so nothing new does. 1.0.2's reply has `data` and no `text`.
//
// `token` is the caller's Supabase JWT: the endpoint is authenticated, and the
// worker holds no session of its own.

export default {
  kind: 'PARSE_RESUME',
  from: ['site'],

  async handle(msg, { fetch, apiUrl, log }) {
    const data = msg.data || {};
    const { fileData, fileName, fileType, token } = data;
    try {
      const res = await fetch(`${apiUrl}/api/parse-resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ fileData, fileName, fileType }),
      });
      const body = await res.json();
      if (res.ok && body.data) {
        // `text` is the raw transcription alongside the structured `data`.
        // The corpus builder and the fabrication validator both diff against
        // it, and the file bytes are discarded after this call — so if it is
        // dropped here, the only way to recover it is another upload. Older
        // server builds do not return it; forwarding undefined is harmless.
        return { success: true, data: body.data, text: body.text };
      }
      log.error('resume parse rejected by server', {
        status: res.status,
        requestId: res.headers.get('X-Request-Id'),
      });
      return {
        success: false,
        error: body.error || `Resume parse failed (${res.status})`,
        debug: { status: res.status },
      };
    } catch (err) {
      log.error('resume parse request failed', err, { fileType, api: apiUrl });
      return { success: false, error: err.message };
    }
  },
};
