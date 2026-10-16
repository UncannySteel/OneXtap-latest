/**
 * Prompt text for POST /api/parse-resume (server/routes/resume.js): the
 * schema, the request, and the one JSON repair attempt.
 */

// ═══ THIS SCHEMA IS HALF OF A CONTRACT ═══
//
// The other half is src/resumeToProfile.js, which translates these key
// names into the ones the profile editor renders. They are deliberately
// NOT the same names — renaming them here would silently change what
// buildCorpus() indexes and what the fabrication validator diffs against,
// because the resume library stores this shape verbatim.
//
// So: a key added here needs a line in resumeToProfile.js before it
// reaches a user. A key RENAMED here breaks the library as well as the
// editor. The fields below beyond the original set — specialization,
// minor, certificate expiry, a second address line — were added because
// the editor has inputs for them and resumes state them, so leaving them
// out of the schema meant asking the user to retype what the document in
// front of the model already said.
export const RESUME_PARSE_SYSTEM_INSTRUCTION = `You are a resume parser. Extract structured data from the resume text below and return ONLY valid JSON (no markdown fences, no explanation). Use this exact schema:
{
  "firstName": "",
  "lastName": "",
  "email": "",
  "phone": "",
  "address": { "street": "", "line2": "", "city": "", "state": "", "zip": "", "country": "" },
  "education": [{ "school": "", "degree": "", "field": "", "specialization": "", "minor": "", "startDate": "", "endDate": "", "gpa": "" }],
  "experience": [{ "company": "", "title": "", "startDate": "", "endDate": "", "description": "" }],
  "skills": [""],
  "urls": [{ "type": "linkedin|github|portfolio|other", "value": "" }],
  "certificates": [{ "name": "", "issuer": "", "date": "", "expiry": "" }],
  "currentJob": { "company": "", "title": "" },
  "__rawText": ""
}
Omit fields you cannot find. Return only the JSON object.

Field notes:
- "endDate": write it exactly as the resume does. "Present" for a role or
  degree still running, "Expected May 2026" for one not finished — those
  words are read downstream and must not be normalised away.
- "specialization" and "minor": only when the resume names them as such.
  Do not split a combined field of study into them.
- "address.line2": apartment, suite or unit, when stated separately.

"__rawText" is the complete plain-text content of the document, transcribed
verbatim in reading order: every heading, bullet and line, with line breaks
preserved and nothing summarised, reordered, corrected or omitted. It is a
transcription, not a rewrite.`;

export function resumeParsePrompt(fileName) {
  return `Parse this resume file (filename: ${fileName || 'resume'}).
Use the attached file content, not guesses.
Return only valid JSON matching the schema.`;
}

export function resumeRepairPrompt(raw) {
  return `Convert the following into valid JSON only.
Do not add explanations, markdown, or code fences.

${raw}`;
}
