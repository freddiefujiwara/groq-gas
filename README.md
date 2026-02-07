# Google Apps Script Groq API Wrapper

This repository contains a Google Apps Script (GAS) project that acts as a Web App API to interface with the Groq API. It includes a caching mechanism to optimize API usage.

## Features

- **Web App API**: Responds to HTTP GET requests with JSON data.
- **Groq API Integration**: Uses the Llama 3.3 70b model via Groq.
- **Caching**: Results are cached for 6 hours (maximum allowed by CacheService) to improve performance and reduce API calls.
- **Cache Bypass**: Append `&cache=no` to the URL to force a fresh response from the Groq API.
- **Unit Testing**: Fully tested using Vitest with 100% code coverage.
- **English Documentation**: All code comments and documentation are in English.

## Project Structure

- `src/Code.js`: Source code for the Google Apps Script.
- `test/Code.spec.js`: Unit tests for the source code.
- `build.js`: Script to prepare the code for deployment by removing `export` keywords.
- `appsscript.json`: GAS manifest file.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set up your Groq API Key:
   In your Google Apps Script project, go to **Project Settings** > **Script Properties** and add a property named `GROQ_API_KEY` with your actual API key.

## Development

### Testing

To run the unit tests and check code coverage:
```bash
npm test
```

### Building

To prepare the code for deployment (outputs to `dist/Code.gs`):
```bash
npm run build
```

### Deployment

To deploy to Google Apps Script using clasp:
```bash
npm run deploy
```

## API Usage

Once deployed as a Web App, you can access the API by appending a `p` parameter to the URL:

`https://script.google.com/macros/s/.../exec?p=Your+Prompt+Here`

### Bypassing Cache

To bypass the cache and get a fresh response:

`https://script.google.com/macros/s/.../exec?p=Your+Prompt+Here&cache=no`

### Response Format

```json
{
  "prompt": "Your Prompt Here",
  "answer": "Groq API response content",
  "cached": false
}
```
