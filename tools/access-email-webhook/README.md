# LinkSim Access Email Webhook Worker

This worker receives LinkSim access-granted webhook calls and forwards email through Resend.

## Required secrets
- WEBHOOK_BEARER
- RESEND_API_KEY
- FROM_EMAIL

## Deploy
npm install
npx wrangler secret put WEBHOOK_BEARER
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put FROM_EMAIL
npm run deploy
