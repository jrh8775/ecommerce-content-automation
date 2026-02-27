# E-Commerce Content Automation API

Automatically generate optimized product content for Amazon using OpenAI and Google Sheets.

## Features
- AI-powered content generation
- SEO-optimized titles and bullet points
- Google Sheets integration
- Batch processing

## Setup

1. Install dependencies: `npm install`
2. Create `.env` file with your API keys
3. Run: `npm start`

## API Endpoints

POST /api/generate-content - Generate content for one product
POST /api/process-products - Batch process from Google Sheets

## Environment Variables

OPENAI_API_KEY - Your OpenAI key
OPENAI_MODEL - Use gpt-3.5-turbo
GOOGLE_SERVICE_ACCOUNT_KEY - Path to credentials.json
PORT - Server port (3000)

## License

MIT
