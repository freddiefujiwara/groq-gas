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

    it('should return cached response if available', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = {
        get: vi.fn().mockReturnValue(JSON.stringify({ status: 'success', content: 'cached answer' })),
        put: vi.fn()
      };
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

    it('should discard legacy cached strings that are not JSON and call Groq', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = { get: vi.fn().mockReturnValue('cached answer'), put: vi.fn() };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      // callGroq mocks
      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({
        choices: [{ message: { content: 'fresh answer' } }]
      })) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(mockCache.get).toHaveBeenCalledWith('groq_encodedKey');
      expect(global.UrlFetchApp.fetch).toHaveBeenCalled();
      expect(mockCache.put).toHaveBeenCalledWith(
        'groq_encodedKey',
        JSON.stringify({ status: 'success', content: 'fresh answer' }),
        21600
      );
      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          prompt: 'hello',
          answer: 'fresh answer',
          cached: false
        })
      );
      expect(result).toBe(mockOutput);
    });

    it('should discard cached JSON missing content and call Groq', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = {
        get: vi.fn().mockReturnValue(JSON.stringify({ status: 'success' })),
        put: vi.fn()
      };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({
        choices: [{ message: { content: 'fresh answer' } }]
      })) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(mockCache.get).toHaveBeenCalledWith('groq_encodedKey');
      expect(global.UrlFetchApp.fetch).toHaveBeenCalled();
      expect(mockCache.put).toHaveBeenCalledWith(
        'groq_encodedKey',
        JSON.stringify({ status: 'success', content: 'fresh answer' }),
        21600
      );
      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          prompt: 'hello',
          answer: 'fresh answer',
          cached: false
        })
      );
      expect(result).toBe(mockOutput);
    });

    it('should call Groq and cache result if not in cache', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = { get: vi.fn().mockReturnValue(null), put: vi.fn() };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      // callGroq mocks
      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({
        choices: [{ message: { content: 'groq answer' } }]
      })) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(mockCache.put).toHaveBeenCalledWith(
        'groq_encodedKey',
        JSON.stringify({ status: 'success', content: 'groq answer' }),
        21600
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

    it('should bypass cache if parameter cache is no', () => {
      const e = { parameter: { p: 'hello', cache: 'no' } };
      const mockCache = { get: vi.fn().mockReturnValue('cached answer'), put: vi.fn() };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      // callGroq mocks
      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({
        choices: [{ message: { content: 'fresh answer' } }]
      })) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      // Verify cache was NOT queried
      expect(mockCache.get).not.toHaveBeenCalled();

      // Verify Groq was called
      expect(global.UrlFetchApp.fetch).toHaveBeenCalled();

      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          prompt: 'hello',
          answer: 'fresh answer',
          cached: false
        })
      );
      expect(result).toBe(mockOutput);
    });

    it('should not cache failed Groq responses', () => {
      const e = { parameter: { p: 'hello' } };
      const mockCache = { get: vi.fn().mockReturnValue(null), put: vi.fn() };
      global.CacheService.getScriptCache.mockReturnValue(mockCache);

      const mockBlob = { getBytes: vi.fn().mockReturnValue([1, 2, 3]) };
      global.Utilities.newBlob.mockReturnValue(mockBlob);
      global.Utilities.base64Encode.mockReturnValue('encodedKey');

      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      global.UrlFetchApp.fetch.mockImplementation(() => {
        throw new Error('Network Error');
      });

      const mockOutput = { setMimeType: vi.fn() };
      global.ContentService.createTextOutput.mockReturnValue(mockOutput);

      const result = Code.doGet(e);

      expect(mockCache.put).not.toHaveBeenCalled();
      expect(global.ContentService.createTextOutput).toHaveBeenCalledWith(
        JSON.stringify({
          prompt: 'hello',
          answer: 'Error: Network Error',
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
      expect(result).toEqual({ status: 'success', content: 'groq answer' });
    });

    it('should return error message if fetch fails', () => {
      const prompt = 'hello';
      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      global.UrlFetchApp.fetch.mockImplementation(() => {
        throw new Error('Network Error');
      });

      const result = Code.callGroq(prompt);

      expect(result).toEqual({ status: 'error', content: 'Error: Network Error' });
    });

    it('should return error when response lacks content', () => {
      const prompt = 'hello';
      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({
        error: { message: 'Bad response' }
      })) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const result = Code.callGroq(prompt);

      expect(result).toEqual({ status: 'error', content: 'Bad response' });
    });

    it('should return default error when response has no message', () => {
      const prompt = 'hello';
      const mockProperties = { getProperty: vi.fn().mockReturnValue('api-key') };
      global.PropertiesService.getScriptProperties.mockReturnValue(mockProperties);

      const mockResponse = { getContentText: vi.fn().mockReturnValue(JSON.stringify({})) };
      global.UrlFetchApp.fetch.mockReturnValue(mockResponse);

      const result = Code.callGroq(prompt);

      expect(result).toEqual({ status: 'error', content: 'Unexpected response format' });
    });
  });
});
