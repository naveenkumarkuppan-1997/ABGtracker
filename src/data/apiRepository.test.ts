import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, requestHeaders } from './apiRepository';

afterEach(() => vi.unstubAllGlobals());

describe('how the browser talks to the server', () => {
  it('sends a JSON content-type only when there is a JSON body', () => {
    expect(requestHeaders(true)).toEqual({ 'content-type': 'application/json', 'x-requested-with': 'abg-tracker' });
    expect(requestHeaders(false)).toEqual({ 'x-requested-with': 'abg-tracker' }); // always the anti-forgery header
  });

  it('sign-out, test email and the AI buttons are sent without a JSON content-type', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
    });
    await api.logout();
    await api.sendTestEmail();
    await api.briefing('acme');
    await api.summarize('acme', 'PLT-1');
    await api.twoFactorBegin();
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      expect((c.init.headers as Record<string, string>)['content-type'], c.url).toBeUndefined();
      expect(c.init.body, c.url).toBeUndefined();
    }
    await api.changePassword('a', 'b'); // calls that do have a body still say so
    expect((calls[5].init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(calls[5].init.body).toBe(JSON.stringify({ current: 'a', next: 'b' }));
  });
});
