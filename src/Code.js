/**
 * API that returns JSON, published as a Web App
 * Access by appending ?p=prompt to the end of the URL
 *
 * Every request must carry the shared token stored in the API_TOKEN
 * script property: as the `token` parameter (GET, or POST via the
 * query string) or as the `token` field of the JSON body (POST).
 * The endpoint answers LLM prompts with the owner's Groq key, so it
 * fails closed: when API_TOKEN is not set, all requests are rejected.
 */
const MAX_PROMPT_LENGTH = 20000;

function isAuthorized(providedToken) {
  const expected = PropertiesService.getScriptProperties().getProperty(
    "API_TOKEN"
  );
  return (
    Boolean(expected) &&
    typeof providedToken === "string" &&
    providedToken === expected
  );
}

function validateRequest(prompt, providedToken) {
  if (typeof prompt !== "string" || !prompt) {
    return "Parameter 'p' is required.";
  }
  if (!isAuthorized(providedToken)) {
    return "Unauthorized.";
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return "Prompt is too long.";
  }
  return null;
}

export function doGet(e) {
  // 1. Get the prompt from parameter p
  const parameter = (e && e.parameter) || {};
  const prompt = parameter.p;

  const error = validateRequest(prompt, parameter.token);
  if (error) {
    return createJsonResponse({ error });
  }

  // Skip cache if parameter cache is 'no'
  const useCache = parameter.cache !== 'no';
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
  let bodyToken;
  const contents = e && e.postData && e.postData.contents ? e.postData.contents : '';
  try {
    const body = JSON.parse(contents);
    prompt = body.p || body.prompt || '';
    bodyToken = body.token;
  } catch (err) {
    prompt = contents;
  }

  const providedToken = bodyToken || (e && e.parameter ? e.parameter.token : undefined);
  const error = validateRequest(prompt, providedToken);
  if (error) {
    return createJsonResponse({ error });
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
    if (
      parsed &&
      parsed.status === "success" &&
      typeof parsed.content === "string" &&
      parsed.content
    ) {
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
    if (typeof content === "string" && content) {
      return { status: "success", content };
    }
    const upstreamMessage = json?.error?.message;
    const errorMessage =
      typeof upstreamMessage === "string" && upstreamMessage
        ? upstreamMessage
        : "Unexpected response format";
    return { status: "error", content: errorMessage };
  } catch (e) {
    return { status: "error", content: errorText_(e) };
  }
}

function errorText_(e) {
  try {
    return e.toString();
  } catch (ignored) {
    return "Unknown error";
  }
}
