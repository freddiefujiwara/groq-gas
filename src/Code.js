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

  // 2. Check the cache
  const cache = CacheService.getScriptCache();
  // Base64 encode the prompt to use as a key to prevent key conflicts
  const cacheKey = "groq_" + Utilities.base64Encode(Utilities.newBlob(prompt).getBytes()).substring(0, 200);

  // Skip cache if parameter cache is 'no'
  const useCache = e.parameter.cache !== 'no';
  const cachedResponse = useCache ? cache.get(cacheKey) : null;

  let result;
  let isCached = false;

  if (cachedResponse != null) {
    result = JSON.parse(cachedResponse);
    isCached = true;
  } else {
    // 3. Call Groq if not in cache or forced by cache=no
    result = callGroq(prompt);
    // 4. Save the result to cache (for 6 hours / 21600 seconds)
    if (result.status === "success") {
      cache.put(cacheKey, JSON.stringify(result), 21600);
    }
  }

  // 5. Return the response in JSON format
  return createJsonResponse({
    prompt: prompt,
    answer: result,
    cached: isCached
  });
}

/**
 * Helper function to create a JSON response
 */
export function createJsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Groq API call
 */
export function callGroq(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY');
  const apiUrl = "https://api.groq.com/openai/v1/chat/completions";
  
  const payload = {
    "model": "llama-3.3-70b-versatile",
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
