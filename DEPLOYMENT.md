# Deployment Guide

## Prerequisites for Production

1. OpenAI Account with paid plan
2. Google Cloud credentials
3. .env file with API keys (never commit)

## Local Setup

npm install
cp .env.example .env
npm start

## Deployment

### Heroku
heroku create app-name
heroku config:set OPENAI_API_KEY=sk-...
git push heroku main

### Docker
docker build -t app .
docker run -p 3000:3000 --env-file .env app

## Security

- Never commit .env or credentials.json
- Rotate API keys regularly
- Use HTTPS in production
- Validate all inputs
- Rate limit endpoints
