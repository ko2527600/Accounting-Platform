# Deployment Setup Guide

Based on your platform (looks like Railway/Render/Vercel), here's how to fix the failed deployments.

## Step 1: Platform Configuration

### If using Railway/Render:

**Build Command:**
```bash
cd backend && npm install && npx prisma generate && npm run build
```

**Start Command:**
```bash
cd backend && npm start
```

**Root Directory:**
```
backend
```

### If using Vercel:

Vercel is primarily for frontend. For the backend, use Railway or Render instead.

## Step 2: Environment Variables to Set

Go to your deployment platform's Environment section and add:

```bash
# Required
NODE_ENV=production
PORT=4000
DATABASE_URL=your_database_url_from_platform

# Optional but recommended
REDIS_URL=your_redis_url_if_available

# Generate a secure JWT secret
JWT_SECRET=<run: openssl rand -base64 32>

# Disable telemetry for now (enable later)
OTEL_ENABLED=false
```

## Step 3: Database Setup

Your platform shows a "Primary database" section. 

### Connect to it:

1. Click on **"Primary database"** in the left sidebar
2. Copy the **Connection String** (should look like: `postgres://username:password@host:5432/database`)
3. Add it as `DATABASE_URL` in your Environment Variables

### Run Migrations:

After setting up the database URL, the platform should automatically run migrations on deploy. If not, add this to your build command:

```bash
cd backend && npm install && npx prisma generate && npx prisma migrate deploy && npm run build
```

## Step 4: Buckets (Object Storage) Setup

The "BUCKETS" section is for file storage (needed for `attached_documents` table).

### To create a bucket:

1. Click the **"+"** next to BUCKETS
2. Name it: `accounting-documents`
3. Copy the credentials provided
4. Add to environment variables:

```bash
# AWS S3 format (adjust based on your platform)
S3_BUCKET_NAME=accounting-documents
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=your_access_key
S3_SECRET_ACCESS_KEY=your_secret_key
S3_ENDPOINT=https://your-platform-endpoint.com
```

You'll need to implement file upload later using these credentials.

## Step 5: Deploy Button

After setting up the above:

1. Click the green **"Deploy"** button in the top right
2. Or push to the `main` branch (if auto-deploy is enabled)

## Step 6: Verify Deployment

Once deployed, check:

1. **Deployment Status**: Should show "SUCCESS" instead of "FAILED"
2. **Service Endpoint**: Click "Visit" to see if the API is running
3. **Health Check**: Visit `https://your-app-url.com/health/live`

## Troubleshooting Failed Deployments

### Error: "Not created yet"

This usually means:
- Build command is incorrect
- Missing required environment variables
- Database connection failed

### Check Logs:

1. Click on a failed deployment
2. Look at the "Logs" tab
3. Find the error message

### Common Fixes:

**"Cannot find module 'prisma'"**
```bash
# Add to build command:
npm install && npx prisma generate
```

**"P1001: Can't reach database server"**
```bash
# Check DATABASE_URL is set correctly
# Ensure database is in same region/network
```

**"Port already in use"**
```bash
# Let platform assign port dynamically
# In your code, use: process.env.PORT || 4000
```

## Platform-Specific Instructions

### Railway

1. **New Project** → Connect your GitHub repo
2. **Settings** → Set Root Directory to `backend`
3. **Variables** → Add environment variables
4. **Deploy** → Will auto-deploy on git push

### Render

1. **New Web Service** → Connect repo
2. **Root Directory**: `backend`
3. **Build Command**: `npm install && npx prisma generate && npm run build`
4. **Start Command**: `npm start`
5. **Environment** → Add variables

### Heroku

1. **Create app**: `heroku create accounting-platform-api`
2. **Add buildpack**: `heroku buildpacks:add heroku/nodejs`
3. **Set root**: Add `heroku.yml` with `run: cd backend && npm start`
4. **Deploy**: `git push heroku main`

## After Successful Deployment

You should see:
- ✅ Status: "ACTIVE" or "SUCCESS"
- ✅ Service is "SERVING" traffic
- ✅ Health endpoint returns 200 OK
- ✅ Can access API at the provided URL

## Quick Fix for Current Failed Deployments

Based on your screenshot, try this:

1. Go to **Settings** → **Service**
2. Set **Root Directory**: `backend`
3. Set **Build Command**: `npm install && npx prisma generate && npm run build`
4. Set **Start Command**: `npm start`
5. Go to **Variables** tab
6. Add `DATABASE_URL` from your database connection string
7. Add `NODE_ENV=production`
8. Add `PORT=4000`
9. Click **Deploy** button (top right green button)

## Need Help?

If deployments still fail:
1. Screenshot the deployment logs
2. Check which platform you're using (Railway/Render/other)
3. Verify DATABASE_URL is correctly set
4. Ensure you're deploying the correct branch
