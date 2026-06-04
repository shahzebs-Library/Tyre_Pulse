# Deploy TyrePulse React App

## Step 1 — Supabase Setup
1. Go to supabase.com → New Project
2. SQL Editor → paste SUPABASE_SCHEMA.sql → Run
3. Storage → New bucket → name: tyre-photos → Public: ON
4. Settings → API → copy URL and anon key

## Step 2 — Environment
cp .env.example .env
# Edit .env with your Supabase URL and key

## Step 3 — Install & Deploy
npm install
npm run build
npx vercel --prod

## Step 4 — First Login
In Supabase: Authentication → Users → Invite User
Use that email/password to log in.

## Default Cost Per Tyre
Set in Settings page after login. Default: SAR 1,200

Built by Shahzeb Rahman © 2026
