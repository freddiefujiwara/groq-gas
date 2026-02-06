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

  const now = new Date().getTime();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const SIX_HOURS_S = 6 * 60 * 60;

  // 2. Check the cache
  const cache = CacheService.getScriptCache();
  // Base64 encode the prompt to use as a key to prevent key conflicts
  const cacheKey = "groq_" + Utilities.base64Encode(Utilities.newBlob(prompt).getBytes()).substring(0, 200);

  let result = cache.get(cacheKey);
  let isCached = false;

  if (result != null) {
    isCached = true;
  } else {
    // Check secondary cache (PropertiesService) for 1-day storage
    const props = PropertiesService.getScriptProperties();
    const secondaryCached = props.getProperty(cacheKey);
    if (secondaryCached != null) {
      try {
        const data = JSON.parse(secondaryCached);
        if (data.e > now) {
          result = data.v;
          isCached = true;
          // Refresh primary cache (6 hours)
          cache.put(cacheKey, result, SIX_HOURS_S);
        }
      } catch (err) {
        // If parsing fails, ignore and proceed to call API
      }
    }
  }

  if (!isCached) {
    // 3. Call Groq if not in cache
    result = callGroq(prompt);

    // 4. Save the result to cache
    // Primary cache (max 6 hours for CacheService)
    cache.put(cacheKey, result, SIX_HOURS_S);

    // Secondary cache (1 day using PropertiesService, 9KB limit per property)
    const secondaryData = JSON.stringify({ v: result, e: now + ONE_DAY_MS });
    if (secondaryData.length <= 9000) {
      PropertiesService.getScriptProperties().setProperty(cacheKey, secondaryData);
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
    return json.choices[0].message.content;
  } catch (e) {
    return "Error: " + e.toString();
  }
}
