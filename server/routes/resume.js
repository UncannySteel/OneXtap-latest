/**
 * Resume parsing: POST /api/parse-resume, through Gemini. Prompt text is in
 * server/prompts/resumeParse.js; the larger JSON body limit for this path is
 * mounted in server/app.js.
 */
import express from 'express';
import { requireAuth } from '../supabase.js';
import { log } from '../logger.js';
import { parseJsonLenient } from '../llmJson.js';
import { callGemini } from '../lib/gemini.js';
import {
  RESUME_PARSE_SYSTEM_INSTRUCTION,
  resumeParsePrompt,
  resumeRepairPrompt,
} from '../prompts/resumeParse.js';

const router = express.Router();

// extractFirstJsonObject() and parseJsonLenient() moved to ./llmJson.js so the
// ranking graph parses model output with the same battle-tested code rather
// than a third copy of it. parseJsonLenient is imported at the top of this file.

// ------------------------------------------------------------------
// POST /api/parse-resume — extract structured profile from resume via Gemini
// ------------------------------------------------------------------

/**
 * Largest resume file accepted, in decoded bytes.
 *
 * Mirrors MAX_RESUME_BYTES in src/resumeParse.js, which is what users actually
 * hit — this is the server's own floor under a body that did not come from our
 * client. Change one side, change both, and check the express.json() limit
 * mounted on this path stays above 4/3 of it.
 */
const RESUME_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Decoded byte length of a base64 payload, without decoding it.
 *
 * `Buffer.from(s, 'base64')` would answer the same question by allocating the
 * megabytes we are trying to decide whether to accept.
 *
 * @param {unknown} value
 * @returns {number} 0 for anything that is not a string.
 */
function base64ByteLength(value) {
  if (typeof value !== 'string' || !value) return 0;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

router.post('/api/parse-resume', requireAuth, async (req, res) => {
  try {
    const { fileData, fileName, fileType } = req.body || {};
    if (!fileData) return res.status(400).json({ error: 'No file data provided' });

    const byteLength = base64ByteLength(fileData);
    if (byteLength > RESUME_MAX_BYTES) {
      return res.status(413).json({
        error: `Resume is too large (${(byteLength / (1024 * 1024)).toFixed(1)} MB). The limit is 2 MB.`,
      });
    }

    const systemInstruction = RESUME_PARSE_SYSTEM_INSTRUCTION;

    const mimeType = (typeof fileType === 'string' && fileType.trim()) || 'application/pdf';
    const supportedMimeTypes = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/heic',
      'image/heif',
    ]);
    if (!supportedMimeTypes.has(mimeType)) {
      return res.status(400).json({
        error: `Unsupported resume file type (${mimeType}). Please upload PDF or image files.`,
      });
    }
    const prompt = resumeParsePrompt(fileName);

    const { text: raw } = await callGemini({
      prompt,
      systemInstruction,
      // Raised from 2048 with the addition of "__rawText": the structured
      // fields alone fit comfortably in 2048, but a verbatim transcription of
      // a two-page resume does not, and a truncated response is an unparseable
      // one. The budget is a ceiling, not a cost — a short resume still
      // returns a short response.
      maxTokens: 8192,
      temperature: 0.1,
      inlineData: {
        mimeType,
        data: fileData,
      },
    });

    let data;
    try {
      data = parseJsonLenient(raw);
    } catch {
      // One repair attempt: ask model to return strictly valid JSON only.
      const repairPrompt = resumeRepairPrompt(raw);

      const { text: repairedRaw } = await callGemini({
        prompt: repairPrompt,
        maxTokens: 8192,
        temperature: 0,
      });

      data = parseJsonLenient(repairedRaw);
    }

    // ═══ ADDITIVE, AND PROVABLY SO ═══
    //
    // The response is now { data, text }. `data` keeps EXACTLY the shape it
    // has always had: __rawText is deleted from it before it is returned, so
    // an existing caller that destructures `{ data }` sees a byte-identical
    // object and nothing downstream of it changes.
    //
    // WHY THE TEXT HAS TO COME BACK AT ALL: the corpus builder and the
    // fabrication validator both work against the resume's raw text, and
    // sourceSpan offsets are meaningless without it. The uploaded file's bytes
    // are discarded the moment this response is written, so the only
    // alternative to this key is asking the user to upload the same file a
    // second time.
    //
    // It rides along inside the existing extraction call rather than costing a
    // second one: the model is already reading the document.
    let text = '';
    if (data && typeof data === 'object') {
      if (typeof data.__rawText === 'string') text = data.__rawText;
      delete data.__rawText;
    }

    return res.json({ data, text });
  } catch (error) {
    log.error('POST /api/parse-resume error:', error?.message || error);
    if (error instanceof SyntaxError) {
      return res.status(502).json({ error: 'AI returned invalid JSON. Please try again.' });
    }
    return res.status(500).json({ error: error?.message || 'Resume parsing failed' });
  }
});

export default router;
