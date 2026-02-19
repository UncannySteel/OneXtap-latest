# Deploy Dashboard to Puter

## ✅ Dashboard is Complete!

Yes, your dashboard is fully functional and ready to deploy! It includes:
- ✅ Profile management
- ✅ Answer Vault
- ✅ Puter authentication
- ✅ Data syncing
- ✅ All UI components

## 🚀 Deploy to Puter Platform

### Step 1: Build the Dashboard

Build the dashboard as a standalone website (separate from the extension):

```bash
npm run build:dashboard
```

This creates a `dist-dashboard/` folder with your deployable website.

### Step 2: Deploy to Puter

#### Option A: Using Puter Hosting API

1. Sign in to [Puter.com](https://puter.com)
2. Use Puter's hosting to deploy the `dist-dashboard/` folder
3. Your site will be available at: `https://onextap.puter.site`

#### Option B: Using Puter App Builder

1. Go to Puter.com
2. Create a new app
3. Upload the contents of `dist-dashboard/` folder
4. Set the subdomain to `onextap`
5. Deploy

### Step 3: Verify Deployment

1. Visit `https://onextap.puter.site` in your browser
2. You should see the dashboard
3. Click "Continue with Puter" - authentication should work! ✅

### Step 4: Update Extension

The extension is already configured with:
```javascript
const DASHBOARD_URL = "https://onextap.puter.site";
```

So you just need to:
1. Rebuild the extension: `npm run build`
2. Reload extension in Chrome
3. Test! 🎉

## 📁 What Gets Built

When you run `npm run build:dashboard`, it creates:
- `dist-dashboard/index.html` - Main entry point
- `dist-dashboard/assets/` - All CSS and JavaScript bundles
- Ready-to-deploy static website

## 🔄 Development vs Production

### Extension Build (for Chrome)
```bash
npm run build        # Builds extension → dist/
```
- For loading in Chrome as unpacked extension
- Includes extension manifest, content scripts, etc.

### Dashboard Build (for Puter)
```bash
npm run build:dashboard    # Builds website → dist-dashboard/
```
- Standalone React website
- Ready to deploy to Puter
- No extension-specific code

## ✅ After Deployment

Once deployed to Puter:
1. ✅ Dashboard loads at `https://onextap.puter.site`
2. ✅ Puter SDK (`window.puter`) is automatically available
3. ✅ Authentication works
4. ✅ Extension can open dashboard via `DASHBOARD_URL`
5. ✅ Everything syncs properly!

## 🔧 Troubleshooting console errors

When using the dashboard on Puter and clicking **Generate with AI**, you may see these in the console:

| Error | Cause | What to do |
|-------|--------|------------|
| **icon.png 404** | The deployed site was missing `/icon.png`. | Fixed: the dashboard build now copies `public/icon.png` into `dist-dashboard/`. Re-run `npm run build:dashboard` and redeploy. |
| **draggable.js / recorder.js – "Unexpected token 'export'"** | Another Chrome extension (e.g. a recorder or devtools extension) injects ES module scripts without `type="module"`. | From another extension, not Onextap. You can ignore these or disable the other extension on the Puter tab if it bothers you. |
| **api.puter.com/whoami 401** | Puter API returned Unauthorized (not signed in or session expired). | Sign in to Puter on the same browser; refresh the dashboard and try again. |
| **socket.io … ERR_INTERNET_DISCONNECTED** | Your network dropped or is offline. | Check your connection; try again when online. |

For **Generate with AI** to work from the Puter dashboard you need:

1. The Onextap Chrome extension installed and allowed for your Puter site (`externally_connectable`).
2. A job listing open in another tab (that tab is scraped for company/description).
3. Network available so the extension can call the AI API.

If credits deduct then refund, the flow ran but something failed (e.g. no job description found, or AI/network error). Check that the **active tab** is a job page with enough text before clicking Generate.

## 🎯 Quick Checklist

- [ ] Run `npm run build:dashboard`
- [ ] Deploy `dist-dashboard/` folder to Puter
- [ ] Verify dashboard works at `https://onextap.puter.site`
- [ ] Rebuild extension: `npm run build`
- [ ] Reload extension in Chrome
- [ ] Test "Continue with Puter" button
- [ ] Test authentication
- [ ] Celebrate! 🎉

Your dashboard is production-ready! 🚀
