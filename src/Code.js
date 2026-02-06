/**
 * Webアプリとして公開し、JSONを返すAPI
 * URL末尾に ?p=プロンプト を付けてアクセス
 */
function doGet(e) {
  // 1. パラメータ p からプロンプトを取得
  const prompt = e.parameter.p;
  
  if (!prompt) {
    return createJsonResponse({ error: "Parameter 'p' is required." });
  }

  // 2. キャッシュの確認
  const cache = CacheService.getScriptCache();
  // キーの競合を防ぐため、プロンプトをBase64エンコードしてキーにする
  const cacheKey = "groq_" + Utilities.base64Encode(Utilities.newBlob(prompt).getBytes()).substring(0, 200);
  const cachedResponse = cache.get(cacheKey);

  let result;
  let isCached = false;

  if (cachedResponse != null) {
    result = cachedResponse;
    isCached = true;
  } else {
    // 3. キャッシュがない場合はGroqを呼び出す
    result = callGroq(prompt);
    // 4. 結果をキャッシュに保存 (60秒間)
    cache.put(cacheKey, result, 60);
  }

  // 5. JSON形式でレスポンスを返す
  return createJsonResponse({
    prompt: prompt,
    answer: result,
    cached: isCached
  });
}

/**
 * JSONレスポンスを作成する補助関数
 */
function createJsonResponse(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Groq API呼び出し（前回と同様）
 */
function callGroq(prompt) {
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
