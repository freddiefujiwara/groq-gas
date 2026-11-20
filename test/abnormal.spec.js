import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import * as Code from '../src/Code.js';

// Abnormal-case tests: the "input from outside" for this wrapper is
// (a) the HTTP request itself (GET parameters, POST bodies, auth token),
// (b) the Groq API response, and (c) whatever a previous run left in
// CacheService. Every deformed input must fail as a clean JSON error
// for that request only; well-formed traffic must be unchanged.

global.CacheService = {
  getScriptCache: vi.fn()
};

global.Utilities = {
  base64Encode: vi.fn(),
  computeDigest: vi.fn(),
  DigestAlgorithm: { SHA_256: 'SHA_256' },
  Charset: { UTF_8: 'UTF_8' }
};

global.ContentService = {
  createTextOutput: vi.fn(),
  MimeType: { JSON: 'application/json' }
};

global.PropertiesService = {
  getScriptProperties: vi.fn()
};

global.UrlFetchApp = {
  fetch: vi.fn()
};

const TOKEN = 'test-token';
let cacheStore;

const keyFor = (prompt) =>
  'groq_' +
  Buffer.from(createHash('sha256').update(prompt, 'utf8').digest()).toString('base64');

const lastPayload = () => {
  const calls = global.ContentService.createTextOutput.mock.calls;
  return JSON.parse(calls[calls.length - 1][0]);
};

const groqReturns = (bodyText) => {
  global.UrlFetchApp.fetch.mockReturnValue({
    getContentText: vi.fn().mockReturnValue(bodyText)
  });
};

const groqAnswers = (content) => {
  groqReturns(JSON.stringify({ choices: [{ message: { content } }] }));
};

beforeEach(() => {
  vi.clearAllMocks();
  cacheStore = new Map();
  global.CacheService.getScriptCache.mockReturnValue({
    get: vi.fn((k) => (cacheStore.has(k) ? cacheStore.get(k) : null)),
    put: vi.fn((k, v) => cacheStore.set(k, v))
  });
  // Realistic digest: distinct prompts get distinct keys, like GAS SHA-256.
  global.Utilities.computeDigest.mockImplementation((algo, value) => [
    ...createHash('sha256').update(String(value), 'utf8').digest()
  ]);
  global.Utilities.base64Encode.mockImplementation((bytes) =>
    Buffer.from(bytes).toString('base64')
  );
  global.PropertiesService.getScriptProperties.mockReturnValue({
    getProperty: vi.fn((name) => (name === 'API_TOKEN' ? TOKEN : 'api-key'))
  });
  global.ContentService.createTextOutput.mockImplementation(() => ({
    setMimeType: vi.fn()
  }));
  groqAnswers('fresh answer');
});

describe('doGet request boundary', () => {
  it('answers with the required-parameter error when the event has no parameter object', () => {
    expect(() => Code.doGet({})).not.toThrow();
    expect(lastPayload()).toEqual({ error: "Parameter 'p' is required." });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('answers with the required-parameter error when called with no event at all', () => {
    expect(() => Code.doGet()).not.toThrow();
    expect(lastPayload()).toEqual({ error: "Parameter 'p' is required." });
  });

  it('treats a whitespace-only prompt as a prompt (domain decision: only missing/empty is rejected)', () => {
    Code.doGet({ parameter: { p: '   ', token: TOKEN } });

    expect(global.UrlFetchApp.fetch).toHaveBeenCalled();
    expect(lastPayload()).toEqual({ prompt: '   ', answer: 'fresh answer', cached: false });
  });

  it('accepts a prompt of exactly the maximum length', () => {
    const p = 'x'.repeat(20000);
    Code.doGet({ parameter: { p, token: TOKEN } });

    expect(global.UrlFetchApp.fetch).toHaveBeenCalled();
    expect(lastPayload()).toEqual({ prompt: p, answer: 'fresh answer', cached: false });
  });

  it('echoes a prompt with lone surrogates and control characters without throwing', () => {
    const p = 'a\ud800b\u0001c\u0007';
    expect(() => Code.doGet({ parameter: { p, token: TOKEN } })).not.toThrow();
    expect(lastPayload().prompt).toBe(p);
  });

  it.each(['test-tokem', 'test-token ', ' test-token', 'TEST-TOKEN', 'test-tok', ''])(
    'rejects the near-miss token %j',
    (token) => {
      Code.doGet({ parameter: { p: 'hello', token } });

      expect(lastPayload()).toEqual({ error: 'Unauthorized.' });
      expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
    }
  );
});

describe('doPost body shapes', () => {
  it('rejects a numeric p field instead of answering with a deformed prompt', () => {
    Code.doPost({
      postData: { contents: JSON.stringify({ p: 42, token: TOKEN }) },
      parameter: {}
    });

    expect(lastPayload()).toEqual({ error: "Parameter 'p' is required." });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('rejects an object p field instead of answering with a deformed prompt', () => {
    Code.doPost({
      postData: { contents: JSON.stringify({ p: { text: 'hello' }, token: TOKEN }) },
      parameter: {}
    });

    expect(lastPayload()).toEqual({ error: "Parameter 'p' is required." });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('rejects an array p field instead of answering with a deformed prompt', () => {
    Code.doPost({
      postData: { contents: JSON.stringify({ p: ['hello'], token: TOKEN }) },
      parameter: {}
    });

    expect(lastPayload()).toEqual({ error: "Parameter 'p' is required." });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('rejects a numeric prompt field (the {"prompt": ...} spelling)', () => {
    Code.doPost({
      postData: { contents: JSON.stringify({ prompt: 42, token: TOKEN }) },
      parameter: {}
    });

    expect(lastPayload()).toEqual({ error: "Parameter 'p' is required." });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('fails closed on a non-string token field in the body', () => {
    Code.doPost({
      postData: { contents: JSON.stringify({ p: 'hello', token: 123 }) },
      parameter: {}
    });

    expect(lastPayload()).toEqual({ error: 'Unauthorized.' });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('lets a wrong body token override a correct query token (body wins, pinned)', () => {
    Code.doPost({
      postData: { contents: JSON.stringify({ p: 'hello', token: 'wrong' }) },
      parameter: { token: TOKEN }
    });

    expect(lastPayload()).toEqual({ error: 'Unauthorized.' });
  });

  it('falls back to the query token when the body carries none (pinned)', () => {
    Code.doPost({
      postData: { contents: JSON.stringify({ p: 'hello' }) },
      parameter: { token: TOKEN }
    });

    expect(lastPayload()).toEqual({ prompt: 'hello', answer: 'fresh answer', cached: false });
  });

  it('treats a JSON null body as the raw text prompt "null" (fallback design, pinned)', () => {
    Code.doPost({ postData: { contents: 'null' }, parameter: { token: TOKEN } });

    expect(lastPayload()).toEqual({ prompt: 'null', answer: 'fresh answer', cached: false });
  });

  it('does not treat a JSON string body as a raw prompt (pinned)', () => {
    Code.doPost({ postData: { contents: '"hello"' }, parameter: { token: TOKEN } });

    expect(lastPayload()).toEqual({ error: "Parameter 'p' is required." });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  it('answers with the required-parameter error for a missing or empty event', () => {
    expect(() => Code.doPost()).not.toThrow();
    expect(lastPayload()).toEqual({ error: "Parameter 'p' is required." });

    expect(() => Code.doPost({})).not.toThrow();
    expect(lastPayload()).toEqual({ error: "Parameter 'p' is required." });
  });

  it('rejects a raw text body over the length limit', () => {
    Code.doPost({
      postData: { contents: 'x'.repeat(20001) },
      parameter: { token: TOKEN }
    });

    expect(lastPayload()).toEqual({ error: 'Prompt is too long.' });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });
});

describe('callGroq upstream response shapes', () => {
  it('reports a non-JSON upstream body as a string error', () => {
    groqReturns('upstream exploded');

    const result = Code.callGroq('hello');

    expect(result.status).toBe('error');
    expect(typeof result.content).toBe('string');
  });

  it('reports an empty choices array as an unexpected format', () => {
    groqReturns(JSON.stringify({ choices: [] }));

    expect(Code.callGroq('hello')).toEqual({
      status: 'error',
      content: 'Unexpected response format'
    });
  });

  it('reports a null message content as an unexpected format', () => {
    groqReturns(JSON.stringify({ choices: [{ message: { content: null } }] }));

    expect(Code.callGroq('hello')).toEqual({
      status: 'error',
      content: 'Unexpected response format'
    });
  });

  it('uses the error message when the content is an empty string', () => {
    groqReturns(
      JSON.stringify({
        choices: [{ message: { content: '' } }],
        error: { message: 'empty completion' }
      })
    );

    expect(Code.callGroq('hello')).toEqual({ status: 'error', content: 'empty completion' });
  });

  it('does not report a numeric message content as a successful answer', () => {
    groqAnswers(42);

    const result = Code.callGroq('hello');

    expect(result.status).toBe('error');
    expect(typeof result.content).toBe('string');
  });

  it('does not report an object message content as a successful answer', () => {
    groqAnswers({ text: 'hello' });

    const result = Code.callGroq('hello');

    expect(result.status).toBe('error');
    expect(typeof result.content).toBe('string');
  });

  it('does not leak a numeric upstream error message as the answer content', () => {
    groqReturns(JSON.stringify({ error: { message: 42 } }));

    const result = Code.callGroq('hello');

    expect(result.status).toBe('error');
    expect(typeof result.content).toBe('string');
  });

  it('does not leak an object upstream error message as the answer content', () => {
    groqReturns(JSON.stringify({ error: { message: { code: 'model_not_found' } } }));

    const result = Code.callGroq('hello');

    expect(result.status).toBe('error');
    expect(typeof result.content).toBe('string');
  });

  it('survives an unstringifiable thrown value from the fetch layer', () => {
    global.UrlFetchApp.fetch.mockImplementation(() => {
      throw { toString: [] };
    });

    let result;
    expect(() => {
      result = Code.callGroq('hello');
    }).not.toThrow();
    expect(result.status).toBe('error');
    expect(typeof result.content).toBe('string');
  });

  it('survives a null thrown value from the fetch layer', () => {
    global.UrlFetchApp.fetch.mockImplementation(() => {
      throw null;
    });

    let result;
    expect(() => {
      result = Code.callGroq('hello');
    }).not.toThrow();
    expect(result.status).toBe('error');
    expect(typeof result.content).toBe('string');
  });

  it('reports a throwing getContentText as a string error', () => {
    global.UrlFetchApp.fetch.mockReturnValue({
      getContentText: vi.fn().mockImplementation(() => {
        throw new Error('boom');
      })
    });

    expect(Code.callGroq('hello')).toEqual({ status: 'error', content: 'Error: boom' });
  });
});

describe('deformed cache entries', () => {
  it('does not serve a cached error entry as the answer', () => {
    cacheStore.set(keyFor('hello'), JSON.stringify({ status: 'error', content: 'stale failure' }));

    Code.doGet({ parameter: { p: 'hello', token: TOKEN } });

    expect(global.UrlFetchApp.fetch).toHaveBeenCalled();
    expect(lastPayload()).toEqual({ prompt: 'hello', answer: 'fresh answer', cached: false });
  });

  it('does not serve a cached entry whose content is not a string', () => {
    cacheStore.set(keyFor('hello'), JSON.stringify({ status: 'success', content: 123 }));

    Code.doGet({ parameter: { p: 'hello', token: TOKEN } });

    expect(global.UrlFetchApp.fetch).toHaveBeenCalled();
    expect(lastPayload()).toEqual({ prompt: 'hello', answer: 'fresh answer', cached: false });
  });

  it('does not serve a cached entry with an empty-string content', () => {
    cacheStore.set(keyFor('hello'), JSON.stringify({ status: 'success', content: '' }));

    Code.doGet({ parameter: { p: 'hello', token: TOKEN } });

    expect(global.UrlFetchApp.fetch).toHaveBeenCalled();
    expect(lastPayload()).toEqual({ prompt: 'hello', answer: 'fresh answer', cached: false });
  });

  it('discards a cached JSON array and refetches (pinned)', () => {
    cacheStore.set(keyFor('hello'), '[1,2]');

    Code.doGet({ parameter: { p: 'hello', token: TOKEN } });

    expect(global.UrlFetchApp.fetch).toHaveBeenCalled();
    expect(lastPayload()).toEqual({ prompt: 'hello', answer: 'fresh answer', cached: false });
  });

  it('serves a well-formed cached entry even with extra fields (pinned)', () => {
    cacheStore.set(
      keyFor('hello'),
      JSON.stringify({ status: 'success', content: 'kept answer', extra: 'x' })
    );

    Code.doGet({ parameter: { p: 'hello', token: TOKEN } });

    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
    expect(lastPayload()).toEqual({ prompt: 'hello', answer: 'kept answer', cached: true });
  });
});
