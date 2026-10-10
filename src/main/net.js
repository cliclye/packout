const { net } = require('electron');

/** Blue Alliance v3 GET. Runs in the main process so the API key never hits CORS rules. */
async function fetchBlueAlliance(endpoint, apiKey) {
  if (!apiKey) return { status: 401, error: 'Add your Blue Alliance API key in Settings.' };
  const url = `https://www.thebluealliance.com/api/v3${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
  try {
    const res = await net.fetch(url, { headers: { 'X-TBA-Auth-Key': apiKey, 'User-Agent': 'Packout-Desktop' } });
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* leave as text */
    }
    if (!res.ok) {
      const msg = res.status === 401 ? 'Blue Alliance rejected the API key.' : `Blue Alliance returned HTTP ${res.status}.`;
      return { status: res.status, error: msg, data };
    }
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, error: `Could not reach Blue Alliance: ${e.message}` };
  }
}

/**
 * One-shot chat completion for the picklist assistant. Messages are
 * [{role:'user'|'assistant', content}]. Done in main: Anthropic's API rejects
 * browser-origin requests and we don't want keys in the renderer's network log.
 */
async function chat({ provider, apiKey, model, system, messages }) {
  if (!apiKey) return { error: 'Add an API key in Settings → Picklist Assistant.' };
  try {
    let res;
    if (provider === 'anthropic') {
      res = await net.fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 1200, system, messages }),
      });
    } else {
      res = await net.fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages] }),
      });
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = body?.error?.message || `HTTP ${res.status}`;
      return { error: `${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}: ${detail}` };
    }
    const text = provider === 'anthropic' ? body.content?.map((c) => c.text || '').join('') : body.choices?.[0]?.message?.content;
    return text ? { text } : { error: 'The model returned an empty response.' };
  } catch (e) {
    return { error: `Request failed: ${e.message}` };
  }
}

module.exports = { fetchBlueAlliance, chat };
