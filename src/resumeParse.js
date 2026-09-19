import { getAccessToken } from './auth';
import { API_URL } from './config';
import { getExtensionId, hasExtensionRuntime } from './extensionClient';
import { log as baseLog } from './logger';

const log = baseLog.child('resume');

/**
 * Resume parse transport.
 *
 * TRANSPORT ONLY. This module base64s the file, pre-flights the session against
 * GET /api/me, and sends the result to POST /api/parse-resume — through the
 * service worker when the extension is there, directly when it is not. It does
 * not decide what the parsed fields mean and it does not merge anything into a
 * profile — that stays with the caller, which is the only reason this extract
 * was safe to do to working code.
 *
 * ═══ RULE 8 ═══
 *
 * The file crosses the network exactly once, transiently, to be transcribed.
 * Neither the bytes nor the result is persisted here; `resumeStore.js` persists
 * the result locally, and Supabase never sees any of it.
 *
 * ═══ WHY IT RETURNS ERRORS INSTEAD OF THROWING ═══
 *
 * Every failure below is a thing the user can act on — sign in again, check the
 * connection, export the file as a PDF. A rejected promise would make each
 * caller re-derive a message from an exception; a result object keeps the
 * wording in one place.
 *
 * "No extension installed" is no longer among those failures at all: it is not
 * an error condition, it is the web dashboard, and it now picks the other
 * transport instead of apologising.
 *
 * ═══ NOT IMPORTABLE IN BARE NODE ═══
 *
 * This module pulls in `./config`, which reads `import.meta.env.VITE_API_URL`
 * at module scope and throws outside a Vite bundle. `resumeStore.js`
 * deliberately does not import this file — that one-way dependency is what
 * keeps the store runnable under `node --test`, and it is why
 * `saveParsedResume` there matches this module's result shape structurally
 * instead of importing its typedef.
 */

// ------------------------------------------------------------------
// File type gate
// ------------------------------------------------------------------
// Three parallel lists that must move together, and a fourth copy lives in
// `supportedMimeTypes` in server/index.js. The client copy exists so an
// unsupported file produces a sentence instead of an opaque 400.

/**
 * Accepted MIME types. Must match the server's allowlist exactly — a type
 * accepted here and rejected there turns into a 400 the user cannot read.
 */
const ACCEPTED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/**
 * Accepted extensions. Checked as well as the MIME type because browsers
 * report `''` for HEIC/HEIF often enough that a MIME-only gate would reject
 * files the server would happily take.
 */
const ACCEPTED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'];

/** Word documents are rejected server-side; catch them here with a real reason. */
const WORD_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const WORD_EXT = ['.doc', '.docx'];

/**
 * The `accept` attribute for a resume file input.
 *
 * Derived from ACCEPTED_EXT rather than hand-written, so the picker can never
 * be narrower than what `validateType` and the server will take. That
 * deliberately includes `.heic,.heif`: the server accepts both, and a hardcoded
 * "PDF and images" list would grey out a photo straight off an iPhone.
 */
export const RESUME_ACCEPT_ATTR = ACCEPTED_EXT.join(',');

// ------------------------------------------------------------------
// File size gate
// ------------------------------------------------------------------
// A fourth number that has to move with the other three, and this one has two
// copies on the server: `RESUME_MAX_BYTES` in server/index.js (the enforced
// one) and the `express.json()` limit mounted on /api/parse-resume (which must
// stay ~4/3 of it, because base64 inflates the body by a third).
//
// The client copy exists so an oversized file costs nothing: no hash, no
// base64, no upload, and a sentence naming the limit instead of a 413.

/** Largest resume file accepted, in bytes. */
export const MAX_RESUME_BYTES = 2 * 1024 * 1024;

/** The cap as the user sees it, so error copy and UI hints cannot disagree. */
export const MAX_RESUME_LABEL = '2 MB';

/**
 * Bytes as a short human string, for one purpose: telling someone how far over
 * the limit they are. One decimal, because "2.4 MB" is actionable and
 * "2.41 MB" is noise.
 *
 * Rounds UP, not to nearest. At one decimal a file one byte over the cap
 * rounds to "2.0 MB", and "That file is 2.0 MB. The limit is 2 MB" reads as a
 * bug in the limit rather than a fact about the file. Rounding up overstates
 * by less than 0.1 MB and can never contradict the sentence it appears in.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(Math.ceil(bytes / (1024 * 1024) * 10) / 10).toFixed(1)} MB`;
}

/**
 * @typedef {Object} ResumeParseResult
 * @property {boolean} ok
 * @property {{ code: string, message: string }|null} error Null on success.
 * @property {object|null} parsed Raw parsed resume from the server.
 * @property {string} cvText Raw transcription; `''` when the installed
 *   extension build is older than the one that started sending it.
 * @property {string} sourceHash sha256 hex of the file bytes; `''` if unreadable.
 * @property {string} fileName
 * @property {number} fileSize
 * @property {string} mimeType
 */

/**
 * A failed ResumeParseResult, with whatever file metadata is already known.
 *
 * Every field of the success shape is still present, so a caller never has to
 * branch on `ok` before reading `fileName` or `sourceHash`.
 *
 * @param {string} code Stable, machine-readable; the caller may branch on it.
 * @param {string} message Shown to the user as-is.
 * @param {{ sourceHash?: string, fileName?: string, fileSize?: number,
 *   mimeType?: string }} [fields] Known file metadata to carry back anyway.
 * @returns {ResumeParseResult}
 */
function fail(code, message, fields = {}) {
  return {
    ok: false,
    error: { code, message },
    parsed: null,
    cvText: '',
    sourceHash: fields.sourceHash || '',
    fileName: fields.fileName || '',
    fileSize: Number.isFinite(fields.fileSize) ? fields.fileSize : 0,
    mimeType: fields.mimeType || '',
  };
}

/**
 * Parse a resume file through the extension's service worker.
 *
 * @param {File} file
 * @returns {Promise<ResumeParseResult>} Never rejects; check `.ok`.
 */
export async function parseResumeFile(file) {
  if (!file || typeof file !== 'object') {
    return fail('no-file', 'No file selected.');
  }

  const fileName = typeof file.name === 'string' ? file.name : '';
  const mimeType = typeof file.type === 'string' ? file.type : '';
  const fileSize = Number.isFinite(file.size) ? file.size : 0;
  const meta = { fileName, fileSize, mimeType };

  const typeError = validateType(fileName, mimeType);
  if (typeError) return fail(typeError.code, typeError.message, meta);

  // Before the hash and the base64, both of which read the whole file into
  // memory twice over — there is no reason to do that to a file the server
  // will refuse anyway.
  if (fileSize > MAX_RESUME_BYTES) {
    return fail(
      'file-too-large',
      `That file is ${formatFileSize(fileSize)}. The limit is ${MAX_RESUME_LABEL} — export a smaller PDF, or reduce the resolution if it is a scan or photo.`,
      meta,
    );
  }

  // Hash BEFORE the network call, so a caller can check its cache and skip the
  // round trip entirely when it already has this exact file parsed.
  const sourceHash = await computeSourceHash(file);
  const withHash = { ...meta, sourceHash };

  let base64;
  try {
    base64 = await fileToBase64(file);
  } catch (e) {
    log.error('resume file read failed', e);
    return fail('read-failed', e?.message || 'Failed to read file. Please try again.', withHash);
  }

  const token = await getAccessToken();
  if (!token) {
    return fail('not-authenticated', 'Not authenticated. Please sign in first.', withHash);
  }

  if (API_URL) {
    try {
      const meRes = await fetch(`${API_URL}/api/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!meRes.ok) {
        const meBody = await meRes.json().catch(() => ({}));
        return fail(
          'session-rejected',
          `Session token rejected (${meBody.error || meRes.status}). Please sign out and sign in again.`,
          withHash,
        );
      }
    } catch (e) {
      log.warn('session preflight failed', { errName: e?.name });
      return fail('session-rejected', 'Could not reach the Onextap server. Check your connection and try again.', withHash);
    }
  }

  const payload = {
    fileData: base64,
    fileName,
    fileType: mimeType,
    isImage: mimeType.startsWith('image/'),
    isPDF: mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf'),
    token,
  };

  // ═══ TWO TRANSPORTS, ONE REPLY SHAPE ═══
  //
  // With the extension present the request goes through the service worker, as
  // it always has. Without it — the web dashboard in any browser — it goes
  // straight to the same endpoint.
  //
  // The direct path is not a new capability. Everything the service worker
  // needed was already built here: the token is minted by getAccessToken()
  // above, the file is already base64, and the session pre-flight fifteen lines
  // up is itself a plain fetch to /api/me against the same origin. The worker
  // was only ever forwarding those three fields (see the PARSE_RESUME handler
  // in extension/background.js), so routing through it on a browser that has no
  // extension was not a safety boundary — it was an outage. Resume upload is
  // the sole gate on the whole Job Matches page, so this one branch is the
  // difference between a working dashboard and a dead one off Chrome.
  //
  // parseResumeViaApi returns the worker's exact reply shape, so everything
  // below this block is transport-agnostic and unchanged.
  let reply;
  if (hasExtensionRuntime()) {
    const extId = getExtensionId();
    if (!extId) {
      return fail(
        'no-extension-id',
        'Extension ID not available. Open the dashboard from the extension popup (Dashboard button) to link it.',
        withHash,
      );
    }

    log.info('sending resume parse request to the extension', { source: extId });
    const response = await sendParseRequest(extId, payload);

    if (response.runtimeError) {
      log.error('resume parse runtime error', { errName: 'RuntimeError' });
      return fail(
        'runtime-error',
        `${response.runtimeError}. Make sure the extension is installed and reloaded.`,
        withHash,
      );
    }

    reply = response.reply;
    if (!reply) {
      return fail('no-response', 'No response from extension. Make sure the extension is installed and reloaded.', withHash);
    }
  } else {
    log.info('sending resume parse request directly to the api', { source: 'web' });
    reply = await parseResumeViaApi(payload);
  }

  if (!reply.success || !reply.data) {
    const debug = reply.debug ? ` [debug: ${JSON.stringify(reply.debug)}]` : '';
    return fail('parse-failed', `${reply.error || 'Parse failed'}${debug}`, withHash);
  }

  // `text` is a newer addition to the service worker's reply. An extension the
  // user has not reloaded yet will not send it, and that must degrade to an
  // empty transcription rather than failing an upload that otherwise worked.
  const cvText = typeof reply.text === 'string' ? reply.text : '';
  if (!cvText) {
    log.warn('service worker sent no transcription; re-derivation will fall back to parsed fields');
  }

  return { ok: true, error: null, parsed: reply.data, cvText, sourceHash, fileName, fileSize, mimeType };
}

/**
 * Client-side type gate, so an unsupported file produces a sentence instead of
 * an opaque 400 from the server.
 *
 * Extension OR MIME is enough to pass: browsers report `''` for HEIC/HEIF often
 * enough that requiring both would reject files the server would happily take.
 * Word documents are checked first so they get their own actionable message
 * rather than the generic one.
 *
 * @param {string} fileName
 * @param {string} mimeType
 * @returns {{ code: string, message: string }|null} null when the file is
 *   acceptable.
 */
function validateType(fileName, mimeType) {
  const lower = fileName.toLowerCase();
  const hasExtIn = (extensions) => extensions.some((ext) => lower.endsWith(ext));

  if (WORD_MIME.has(mimeType) || hasExtIn(WORD_EXT)) {
    return {
      code: 'word-document',
      message: "Word documents aren't supported yet — export as PDF and upload that.",
    };
  }
  if (hasExtIn(ACCEPTED_EXT) || ACCEPTED_MIME.has(mimeType)) return null;
  return {
    code: 'unsupported-type',
    message: 'Unsupported file type. Upload a PDF or an image (PNG, JPEG, WebP, HEIC).',
  };
}

/**
 * sha256 hex of the RAW FILE BYTES.
 *
 * The bytes, deliberately — not the base64 string and not the file name. The
 * same CV re-exported under a new name must hash the same, and a different CV
 * saved under an old name must not.
 *
 * `crypto.subtle` is a global in browsers and in Node 18+.
 *
 * @param {File} file
 * @returns {Promise<string>} `''` when hashing is unavailable; a caller that
 *   gets `''` simply misses the cache and re-parses, which is safe.
 */
export async function computeSourceHash(file) {
  try {
    const buffer = await readArrayBuffer(file);
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    log.warn('could not hash resume bytes; cache lookup will miss', { errName: e?.name });
    return '';
  }
}

/**
 * `File.arrayBuffer()` with a FileReader fallback for older surfaces.
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
function readArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Base64 the file for transport. Lifted unchanged from ProfilesPage, where it
 * has been working; the FileReader dance and its error wording are the shipped
 * behaviour and are not worth "improving" during an extraction.
 * @param {File} file
 * @returns {Promise<string>} Base64 payload with the data-URL prefix stripped.
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const base64 = reader.result.split(',')[1];
          if (!base64) {
            reject(new Error('Failed to convert file to base64'));
          } else {
            resolve(base64);
          }
        } catch (e) {
          reject(new Error('Failed to process file data: ' + e.message));
        }
      };
      reader.onerror = (error) => {
        reject(new Error('File read error: ' + (error.message || 'Unknown error')));
      };
      reader.readAsDataURL(file);
    } catch (error) {
      reject(new Error('Failed to read file: ' + error.message));
    }
  });
}

/**
 * One PARSE_RESUME round trip to the service worker.
 *
 * Addressed explicitly by extension id because the dashboard is external to
 * the extension; `chrome.runtime.sendMessage(msg, cb)` without an id silently
 * goes nowhere from there.
 *
 * Resolves rather than rejecting so the caller handles one shape.
 *
 * @param {string} extId Target extension id.
 * @param {object} data The PARSE_RESUME payload.
 * @returns {Promise<{ reply: any, runtimeError: string|null }>} Exactly one of
 *   the two is non-null.
 */
/**
 * One resume-parse round trip straight to the backend, for the web dashboard.
 *
 * Deliberately returns the SAME shape as sendParseRequest's `reply` — the
 * object the service worker builds in extension/background.js — so the caller
 * branches on transport once and never again. Divergence here would be the
 * quiet kind: both paths keep working, they just stop agreeing about what a
 * failure looks like.
 *
 * Resolves rather than rejecting, for the reason given in the module header.
 *
 * @param {object} data The same payload PARSE_RESUME carries.
 * @returns {Promise<{success: boolean, data?: any, text?: string,
 *   error?: string, debug?: object}>}
 */
async function parseResumeViaApi({ fileData, fileName, fileType, token }) {
  try {
    const res = await fetch(`${API_URL}/api/parse-resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fileData, fileName, fileType }),
    });

    const body = await res.json().catch(() => ({}));
    if (res.ok && body.data) {
      // `text` rides along with `data`: the corpus builder and the fabrication
      // validator both diff against the raw transcription, and the file bytes
      // are gone after this call. Forwarding undefined is harmless.
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
    log.error('resume parse request failed', { errName: err?.name });
    return { success: false, error: err?.message || 'Could not reach the Onextap server.' };
  }
}

function sendParseRequest(extId, data) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(extId, { action: 'PARSE_RESUME', data }, (reply) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) resolve({ reply: null, runtimeError: lastError.message || 'Extension messaging failed' });
        else resolve({ reply, runtimeError: null });
      });
    } catch (e) {
      resolve({ reply: null, runtimeError: e?.message || 'Extension messaging failed' });
    }
  });
}
