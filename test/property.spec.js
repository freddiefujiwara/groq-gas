import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import * as Code from '../src/Code.js';

// Property-based tests (fast-check). The pure transforms reachable from
// outside are: cache-key derivation (SHA-256 of the whole prompt),
// request validation / auth, response shaping, and upstream-response
// shaping in callGroq. buildCacheKey / parseCachedResponse are not
// exported, so the properties drive them through doGet / doPost /
// callGroq with the GAS services mocked.

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
let seenKeys;

const keyFor = (prompt) =>
  'groq_' +
  Buffer.from(createHash('sha256').update(prompt, 'utf8').digest()).toString('base64');

const lastPayload = () => {
  const calls = global.ContentService.createTextOutput.mock.calls;
  return JSON.parse(calls[calls.length - 1][0]);
};

const isDocumentedShape = (payload) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const keys = Object.keys(payload).sort();
  if (keys.length === 1 && keys[0] === 'error') {
    return typeof payload.error === 'string';
  }
  return (
    keys.length === 3 &&
    keys[0] === 'answer' &&
    keys[1] === 'cached' &&
    keys[2] === 'prompt' &&
    typeof payload.prompt === 'string' &&
    typeof payload.answer === 'string' &&
    typeof payload.cached === 'boolean'
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  cacheStore = new Map();
  seenKeys = [];
  global.CacheService.getScriptCache.mockReturnValue({
    get: vi.fn((k) => {
      seenKeys.push(k);
      return cacheStore.has(k) ? cacheStore.get(k) : null;
    }),
    put: vi.fn((k, v) => cacheStore.set(k, v))
  });
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
  global.UrlFetchApp.fetch.mockReturnValue({
    getContentText: vi
      .fn()
      .mockReturnValue(
        JSON.stringify({ choices: [{ message: { content: 'fresh answer' } }] })
      )
  });
});

// Well-formed strings only for the distinctness property: an unpaired
// surrogate has no UTF-8 encoding, so both GAS (Utilities.computeDigest
// with Charset.UTF_8) and Node replace it with U+FFFD before hashing —
// two prompts differing only in an unpaired surrogate are the same
// input as far as any UTF-8 digest can tell. Distinctness is therefore
// claimed over well-formed prompts; unpaired surrogates are covered by
// the never-throws / echo properties below instead.
const wellFormedPrompt = (maxLength) =>
  fc.string({ unit: 'grapheme-composite', minLength: 1, maxLength });

const keyOf = (prompt) => {
  cacheStore.clear();
  seenKeys = [];
  Code.doGet({ parameter: { p: prompt, token: TOKEN } });
  return seenKeys[0];
};

describe('cache key properties', () => {
  it('gives distinct keys to distinct prompts, even with a long shared prefix, and is stable', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme-composite', minLength: 200, maxLength: 400 }),
        fc.string({ unit: 'grapheme-composite', minLength: 1, maxLength: 1 }),
        fc.string({ unit: 'grapheme-composite', minLength: 1, maxLength: 1 }),
        (prefix, suffixA, suffixB) => {
          fc.pre(suffixA !== suffixB);
          const keyA = keyOf(prefix + suffixA);
          const keyB = keyOf(prefix + suffixB);
          expect(keyA).toBe(keyFor(prefix + suffixA));
          expect(keyB).toBe(keyFor(prefix + suffixB));
          expect(keyA).not.toBe(keyB);
          // Stability: the same prompt derives the same key again.
          expect(keyOf(prefix + suffixA)).toBe(keyA);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('request / response shape properties', () => {
  it('doGet always answers with the documented JSON shape and echoes a well-formed prompt verbatim', () => {
    fc.assert(
      fc.property(
        // Default string unit on purpose: lone surrogates and control
        // characters are in-domain here — JSON.stringify escapes them
        // and the echo must come back byte-identical.
        fc.string({ maxLength: 100 }),
        fc.oneof(fc.constant(TOKEN), fc.string({ maxLength: 16 }), fc.constant(undefined)),
        (p, token) => {
          cacheStore.clear();
          let payload;
          expect(() => {
            Code.doGet({ parameter: { p, token } });
            payload = lastPayload();
          }).not.toThrow();
          expect(isDocumentedShape(payload)).toBe(true);
          if (token === TOKEN && p) {
            expect(payload.prompt).toBe(p);
            expect(payload.answer).toBe('fresh answer');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('doPost never throws and always answers with the documented JSON shape, whatever the body', () => {
    const jsonBodyObject = fc.record(
      { p: fc.jsonValue(), prompt: fc.jsonValue(), token: fc.jsonValue() },
      { requiredKeys: [] }
    );
    const bodyArb = fc.oneof(
      fc.string({ maxLength: 60 }),
      fc.jsonValue().map((v) => JSON.stringify(v)),
      jsonBodyObject.map((v) => JSON.stringify(v))
    );
    fc.assert(
      fc.property(
        bodyArb,
        fc.oneof(fc.constant(TOKEN), fc.string({ maxLength: 16 }), fc.constant(undefined)),
        (contents, queryToken) => {
          cacheStore.clear();
          let payload;
          expect(() => {
            Code.doPost({
              postData: { contents },
              parameter: queryToken === undefined ? {} : { token: queryToken }
            });
            payload = lastPayload();
          }).not.toThrow();
          expect(isDocumentedShape(payload)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('authorization fails closed: only the exact token string is accepted', () => {
    const tokenArb = fc.oneof(
      fc.string({ maxLength: 24 }),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.constant(undefined),
      fc.array(fc.string({ maxLength: 8 }), { maxLength: 2 }),
      // An object whose toString would produce the right token must
      // still fail: authorization compares strings, not stringifications.
      fc.constant({ toString: () => TOKEN })
    );
    fc.assert(
      fc.property(tokenArb, (token) => {
        cacheStore.clear();
        global.UrlFetchApp.fetch.mockClear();
        Code.doGet({ parameter: { p: 'hello', token } });
        if (token === TOKEN) {
          expect(lastPayload().answer).toBe('fresh answer');
        } else {
          expect(lastPayload()).toEqual({ error: 'Unauthorized.' });
          expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('callGroq shaping properties', () => {
  it('always returns {status, content} with a string content, whatever the upstream body', () => {
    const bodyArb = fc.oneof(
      fc.string({ maxLength: 80 }),
      fc.jsonValue().map((v) => JSON.stringify(v)),
      // Targeted well-formed-ish completions with arbitrary content values.
      fc
        .record({ content: fc.jsonValue() })
        .map(({ content }) =>
          JSON.stringify({ choices: [{ message: { content } }] })
        ),
      fc
        .record({ message: fc.jsonValue() })
        .map(({ message }) => JSON.stringify({ error: { message } }))
    );
    fc.assert(
      fc.property(bodyArb, (bodyText) => {
        global.UrlFetchApp.fetch.mockReturnValue({
          getContentText: vi.fn().mockReturnValue(bodyText)
        });
        let result;
        expect(() => {
          result = Code.callGroq('hello');
        }).not.toThrow();
        expect(['success', 'error']).toContain(result.status);
        expect(typeof result.content).toBe('string');
        // A non-empty string completion is the one success shape.
        let parsed;
        try {
          parsed = JSON.parse(bodyText);
        } catch (ignored) {
          parsed = undefined;
        }
        const content = parsed?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content) {
          expect(result).toEqual({ status: 'success', content });
        }
      }),
      { numRuns: 100 }
    );
  });

  it('never throws, whatever the fetch layer throws', () => {
    const thrownArb = fc.constantFrom(
      new Error('network down'),
      'a string failure',
      42,
      null,
      undefined,
      { toString: [] },
      { toString: null },
      Object.create(null)
    );
    fc.assert(
      fc.property(thrownArb, (thrown) => {
        global.UrlFetchApp.fetch.mockImplementation(() => {
          throw thrown;
        });
        let result;
        expect(() => {
          result = Code.callGroq('hello');
        }).not.toThrow();
        expect(result.status).toBe('error');
        expect(typeof result.content).toBe('string');
      }),
      { numRuns: 100 }
    );
  });
});

describe('cache entry properties', () => {
  it('a deformed stored entry never poisons the response: cached answers are always well-formed successes', () => {
    const storedArb = fc.oneof(
      fc.string({ maxLength: 100 }),
      fc.jsonValue().map((v) => JSON.stringify(v)),
      fc
        .record({
          status: fc.jsonValue(),
          content: fc.jsonValue()
        })
        .map((v) => JSON.stringify(v))
    );
    fc.assert(
      fc.property(storedArb, (stored) => {
        cacheStore.clear();
        cacheStore.set(keyFor('hello'), stored);
        let payload;
        expect(() => {
          Code.doGet({ parameter: { p: 'hello', token: TOKEN } });
          payload = lastPayload();
        }).not.toThrow();
        expect(isDocumentedShape(payload)).toBe(true);
        if (payload.cached === true) {
          const parsed = JSON.parse(stored);
          expect(parsed.status).toBe('success');
          expect(typeof parsed.content).toBe('string');
          expect(parsed.content).not.toBe('');
          expect(payload.answer).toBe(parsed.content);
        }
      }),
      { numRuns: 100 }
    );
  });
});
