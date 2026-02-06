import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Code from '../src/Code.js';

// Mocking GAS Global Objects
global.CacheService = {
  getScriptCache: vi.fn()
};

global.Utilities = {
  base64Encode: vi.fn(),
  newBlob: vi.fn()
};

global.ContentService = {
  createTextOutput: vi.fn(),
  MimeType: {
    JSON: 'application/json'
  }
};

global.PropertiesService = {
  getScriptProperties: vi.fn()
};

global.UrlFetchApp = {
  fetch: vi.fn()
};

describe('Code.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('doGet', () => {
    it('should return error if prompt is missing', () => {
      const e = { parameter: {} };
      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({ error: "Parameter 'p' is required." })
      );
      expect(result).toBe(mockOutput);
    });

    it('should return cached response from CacheService if available', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = { get: vi.fn().mockReturnValue('cached answer'), put: vi.fn() };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(mockCache.get).toHaveBeenCalledWith('groq_encodedKey');
      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          prompt: 'hello',
          answer: 'cached answer',
          cached: true
        })
      );
      expect(result).toBe(mockOutput);
    });

    it('should return cached response from PropertiesService if CacheService misses', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = { get: vi.fn().mockReturnValue(null), put: vi.fn() };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      const futureDate = new Date().getTime() + 10000;
      const secondaryData = JSON.stringify({ v: 'secondary answer', e: futureDate });
      const mockProperties = {
        getProperty: vi.fn().mockReturnValue(secondaryData),
        setProperty: vi.fn()
      };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(mockCache.get).toHaveBeenCalledWith('groq_encodedKey');
      expect(mockProperties.getProperty).toHaveBeenCalledWith('groq_encodedKey');
      expect(mockCache.put).toHaveBeenCalledWith('groq_encodedKey', 'secondary answer', 21600);
      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          prompt: 'hello',
          answer: 'secondary answer',
          cached: true
        })
      );
      expect(result).toBe(mockOutput);
    });

    it('should call Groq and cache result if not in both caches', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = { get: vi.fn().mockReturnValue(null), put: vi.fn() };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      // PropertiesService mocks
      const mockProperties = {
        getProperty: vi.fn().mockReturnValue(null), // For API Key and secondary cache
        setProperty: vi.fn()
      };
      // First call is for secondary cache, then for API key, then for setProperty
      mockProperties.getProperty.mockReturnValueOnce(null).mockReturnValueOnce('api-key');
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({
        choices: [{ message: { content: 'groq answer' } }]
      })) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(mockCache.put).toHaveBeenCalledWith('groq_encodedKey', 'groq answer', 21600);
      expect(mockProperties.setProperty).toHaveBeenCalledWith(
        'groq_encodedKey',
        expect.stringContaining('"v":"groq answer"')
      );
      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          prompt: 'hello',
          answer: 'groq answer',
          cached: false
        })
      );
      expect(result).toBe(mockOutput);
    });

    it('should call Groq if PropertiesService cache is expired', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = { get: vi.fn().mockReturnValue(null), put: vi.fn() };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      const pastDate = new Date().getTime() - 10000;
      const secondaryData = JSON.stringify({ v: 'expired answer', e: pastDate });
      const mockProperties = {
        getProperty: vi.fn().mockReturnValueOnce(secondaryData).mockReturnValueOnce('api-key'),
        setProperty: vi.fn()
      };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({
        choices: [{ message: { content: 'fresh answer' } }]
      })) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          prompt: 'hello',
          answer: 'fresh answer',
          cached: false
        })
      );
      expect(result).toBe(mockOutput);
    });

    it('should handle JSON parse error in secondary cache', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = { get: vi.fn().mockReturnValue(null), put: vi.fn() };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      const mockProperties = {
        getProperty: vi.fn().mockReturnValue('invalid-json').mockReturnValueOnce('invalid-json').mockReturnValueOnce('api-key'),
        setProperty: vi.fn()
      };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({
        choices: [{ message: { content: 'recovered answer' } }]
      })) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          prompt: 'hello',
          answer: 'recovered answer',
          cached: false
        })
      );
      expect(result).toBe(mockOutput);
    });
  });

  describe('createJsonResponse', () => {
    it('should create text output with JSON mime type', () => {
      const data = { foo: 'bar' };
      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.createJsonResponse(data);

      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(JSON.stringify(data));
      expect(mockOutput.setMimeType).toHaveBeenCalledWith('application/json');
      expect(result).toBe(mockOutput);
    });
  });

  describe('callGroq', () => {
    it('should fetch from Groq API and return content', () => {
      const prompt = 'hello';
      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({
        choices: [{ message: { content: 'groq answer' } }]
      })) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const result = Code.callGroq(prompt);

      expect(global.UrlFetchApp.fetch).toHaveBeenCalledWith(
        "https://api.groq.com/openai/v1/chat/completions",
        expect.objectContaining({
          method: "post",
          headers: { Authorization: "Bearer api-key" },
          payload: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
          })
        })
      );
      expect(result).toBe('groq answer');
    });

    it('should return error message if fetch fails', () => {
      const prompt = 'hello';
      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      global.UrlFetchApp.fetch.mockImplementation(() => {
        throw new Error('Network Error');
      });

      const result = Code.callGroq(prompt);

      expect(result).toBe('Error: Error: Network Error');
    });
  });
});
