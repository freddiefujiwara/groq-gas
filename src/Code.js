/**
 * API that returns JSON, published as a Web App
 * Access by appending ?p=prompt to the end of the URL
 */
export function doGet(e) {
  // 1. Get the prompt from parameter p
  const prompt = e.parameter.p;

  if (!prompt) {
    return createJsonResponse({ error: "Parameter 'p' is required." });
  }

  // Skip cache if parameter cache is 'no'
  const useCache = e.parameter.cache !== 'no';
  return createJsonResponse(answerPrompt(prompt, useCache));
}

/**
 * POST variant for callers that cannot put a long prompt in a URL
 * (UrlFetchApp rejects URLs over its length limit).
 * Accepts a JSON body {"p": "..."} (or {"prompt": "..."}), or a raw
 * text body treated as the prompt itself.
 */
export function doPost(e) {
  let prompt = '';
  const contents = e && e.postData && e.postData.contents ? e.postData.contents : '';
  try {
    const body = JSON.parse(contents);
    prompt = body.p || body.prompt || '';
  } catch (err) {
    prompt = contents;
  }

  if (!prompt) {
    return createJsonResponse({ error: "Parameter 'p' is required." });
  }

  return createJsonResponse(answerPrompt(prompt, true));
}

function answerPrompt(prompt, useCache) {
  // 2. Check the cache
  const cache = CacheService.getScriptCache();
  // Base64 encode the prompt to use as a key to prevent key conflicts
  const cacheKey = buildCacheKey(prompt);

  const cachedResponse = useCache ? cache.get(cacheKey) : null;

  let result = null;
  let isCached = false;

  result = parseCachedResponse(cachedResponse);
  isCached = result !== null;

  if (!result) {
    // 3. Call Groq if not in cache or forced by cache=no
    result = callGroq(prompt);
    // 4. Save the result to cache (for 6 hours / 21600 seconds)
    if (result.status === "success") {
      cache.put(cacheKey, JSON.stringify(result), 21600);
    }
  }

  // 5. Return the response in JSON format
  return {
    prompt: prompt,
    answer: result.content,
    cached: isCached
  };
}

/**
 * Helper function to create a JSON response
 */
export function createJsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function buildCacheKey(prompt) {
  // Hash the whole prompt: truncating the encoded prompt itself makes
  // long prompts that share a prefix (e.g. templated instructions)
  // collide on the same cache key.
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    prompt,
    Utilities.Charset.UTF_8
  );
  return "groq_" + Utilities.base64Encode(digest);
}

function parseCachedResponse(cachedResponse) {
  if (!cachedResponse) {
    return null;
  }

  try {
    const parsed = JSON.parse(cachedResponse);
    if (parsed && parsed.status && Object.prototype.hasOwnProperty.call(parsed, "content")) {
      return parsed;
    }
  } catch (e) {
    return null;
  }

  return null;
}

/**
 * Groq API call
 */
export function callGroq(prompt) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty('GROQ_API_KEY');
  // Model is configurable via the GROQ_MODEL script property so a retired
  // model can be swapped without a code change. Default matches the model
  // used successfully by time-table-gas.
  const model = scriptProperties.getProperty('GROQ_MODEL') || "llama-3.1-8b-instant";
  const apiUrl = "https://api.groq.com/openai/v1/chat/completions";

  const payload = {
    "model": model,
    "messages": [{"role": "user", "content": prompt}],
    "temperature": 0.7
  };
  
  const options = {
    "method": "post",
    "contentType": "application/json",
    "headers": { "Authorization": "Bearer " + apiKey },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(response.getContentText());
    const content = json?.choices?.[0]?.message?.content;
    if (content) {
      return { status: "success", content };
    }
    const errorMessage = json?.error?.message || "Unexpected response format";
    return { status: "error", content: errorMessage };
  } catch (e) {
    return { status: "error", content: e.toString() };
  }
}
