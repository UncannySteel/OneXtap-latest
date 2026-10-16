// Stands in for src/auth.js in test/extension/resumeParse.test.js (see
// viteModules.js), so a parse has a token without a Supabase client. The test
// sets the token on globalThis.
export async function getAccessToken() {
  return globalThis.__ONEXTAP_TEST_TOKEN__ ?? null;
}
