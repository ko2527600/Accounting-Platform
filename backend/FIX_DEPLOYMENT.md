# Fix Production Deployment Failures

Your database is working locally (17 tables visible), but deployments are failing. Here's how to fix it.

## Common Deployment Issues

### Issue 1: Wrong Build/Start Commands

**Symptoms:** "Not created yet", Build fails, Container crashes

**Fix:** Set these in your platform settings:

```bash
# Root Directory (important!)
backend

# Install Command
npm install

# Build Command
npm install && npx prisma generate && npm run build

# Start Command
npm start

# Node Version (add to package.json if not there)
"engines": {
  "node": ">=20.0.0"
}
```

### Issue 2: Missing Environment Variables

**Symptoms:** Cannot connect to database, Environment errors

**Fix:** Add these environment variables in your platform:

```bash
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://6b93087e9cc3d098689b61b7441f399f5a4c1a7d91a75ae114f1154d01b7562d:sk_XXzycHf4TbhUMiz_AxmRP@pooled.db.prisma.io:5432/postgres?sslmode=require
```

### Issue 3: Migrations Not Running

**Symptoms:** Tables don't exist, Prisma errors

**Fix:** Add migration to build command:

```bash
npm install && npx prisma generate && npx prisma migrate deploy && npm run build
```

### Issue 4: TypeScript Build Failing

**Symptoms:** Build errors, tsc errors

**Fix:** Ensure tsconfig.json exists and dependencies are correct:

```bash
npm install --save-dev typescript @types/node @types/express
```

### Issue 5: Port Binding Issues

**Symptoms:** "Port already in use", EADDRINUSE error

**Fix:** Make sure your app uses process.env.PORT:

```typescript
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Platform-Specific Fixes

### For Railway:

1. Go to **Settings** → **Service**
2. Set **Root Directory**: `backend`
3. Set **Start Command**: `npm start`
4. Go to **Variables** tab
5. Add all environment variables
6. Click **Deploy** (top right)

### For Render:

1. Go to **Settings** → **Build & Deploy**
2. Set **Root Directory**: `backend`
3. Set **Build Command**: `npm install && npx prisma generate && npm run build`
4. Set **Start Command**: `npm start`
5. Go to **Environment** tab
6. Add `DATABASE_URL` and other variables
7. Click **Manual Deploy** → **Deploy latest commit**

### For Vercel (Not Recommended for Backend):

Vercel is for frontend. Use Railway or Render for the backend API.

### For Heroku:

1. Create `Procfile` in backend directory:
   ```
   web: npm start
   ```

2. Create `heroku.yml`:
   ```yaml
   build:
     docker:
       web: Dockerfile
   ```

3. Push to Heroku:
   ```bash
   git push heroku main
   ```

## Debug Deployment Failures

### Step 1: Check Build Logs

Click on the failed deployment → **Logs** tab

Look for errors like:
- `Cannot find module`
- `tsc: command not found`
- `P1001: Can't reach database`
- `EADDRINUSE: Port already in use`

### Step 2: Test Build Locally

```powershell
cd backend

# Clean install
Remove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item dist -Recurse -Force -ErrorAction SilentlyContinue

# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Build
npm run build

# Test start
npm start
```

If this works locally, the issue is with platform configuration.

### Step 3: Check Deployment Configuration

**Root Directory** must be set to `backend` if your repo structure is:
```
accounting-platform/
├── backend/
│   ├── src/
│   ├── package.json
│   └── prisma/
└── frontend/
```

### Step 4: Verify Database Access

Test if your deployment can reach the database:

```bash
# In your deployment platform's shell/terminal
npx prisma db execute --stdin <<< "SELECT NOW();"
```

If this fails, check:
- DATABASE_URL is set correctly
- Database allows connections from the deployment platform's IP
- SSL mode is correct (`sslmode=require`)

## Quick Fix Checklist

- [ ] Platform Root Directory set to `backend`
- [ ] Build command includes `npx prisma generate`
- [ ] Start command is `npm start`
- [ ] DATABASE_URL environment variable is set
- [ ] NODE_ENV=production is set
- [ ] package.json has correct scripts
- [ ] TypeScript is building successfully locally
- [ ] Port is read from process.env.PORT
- [ ] All dependencies are in package.json (not just devDependencies)

## Still Failing?

Share these details:
1. Platform name (Railway/Render/other)
2. Screenshot of deployment logs (the error message)
3. Screenshot of Settings → Build settings
4. Screenshot of Environment variables (blur sensitive values)

## Emergency: Deploy Without Platform

If all else fails, deploy manually to a VPS:

```bash
# On your server
git clone <your-repo>
cd accounting-platform/backend
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
npm start
```

Then use nginx as a reverse proxy to handle traffic.
