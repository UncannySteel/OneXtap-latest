# Deployment Checklist - Quick Answers

## ✅ Pre-upload / final check

Before you upload or load the extension:

| Check | Notes |
|-------|--------|
| **Build** | `npm run build` succeeds |
| **Load `dist/`** | Load unpacked from **`dist/`** in Chrome (not project root) |
| **EXTENSION_ID** | Matches your ID in `chrome://extensions` → `OnextapDashboard.jsx` line 15 |
| **DASHBOARD_URL** | Matches your Puter site (e.g. `onextap-dev.puter.site`) → line 19 |
| **Manifest origins** | If you use a **new** Puter subdomain, add it to `extension/manifest.json` under `externally_connectable.matches` and `content_scripts[].exclude_matches`, then rebuild |

**Manifest:** Use **explicit** subdomains (e.g. `https://onextap-dev.puter.site/*`). Do **not** use `https://*.puter.site/*` in `externally_connectable` or `exclude_matches` — Chrome rejects it (public suffix).

---

## 🗂️ About `dist/` Folder

### Should you delete it from workspace?

**Short answer: NO, keep it** (but it's already git-ignored, so won't be committed)

**Why keep it:**
- Contains your **built Chrome extension**
- Needed to load extension in Chrome
- Already in `.gitignore` (won't be committed to git)

**When you CAN delete it:**
- ✅ To clean up and rebuild fresh
- ✅ If you're having build issues
- ⚠️ Just remember to rebuild with `npm run build` before loading extension in Chrome

## 🌐 About Puter Deployment

### Should you delete and replace on Puter?

**YES - Replace with new build:**

1. **Build the dashboard:**
   ```bash
   npm run build:dashboard
   ```

2. **Go to Puter.com** → Your site at `onextap.puter.site`

3. **Replace/Update files:**
   - Delete old files (or just upload new ones to replace)
   - Upload all files from `dist-dashboard/` folder
   - Your URL stays: `https://onextap.puter.site`

### Keep the same URL?

**YES! Keep `https://onextap.puter.site`**

- No need to change the URL
- Just update the files with the new build
- Extension is already configured with this URL ✅

## ✅ Recommended Workflow

### Step 1: Build Dashboard
```bash
npm run build:dashboard
```
Creates `dist-dashboard/` folder

### Step 2: Deploy to Puter
- Go to Puter.com
- Navigate to `onextap.puter.site` deployment
- **Replace/Upload** all files from `dist-dashboard/` folder
- (You can delete old files first, then upload new ones)

### Step 3: Keep Extension Build
```bash
npm run build  # If you deleted dist/, rebuild it
```
Keep `dist/` folder for Chrome extension (already has correct DASHBOARD_URL)

## 📋 Summary Table

| Item | Action | Notes |
|------|--------|-------|
| `dist/` folder | **Keep it** | For Chrome extension (git-ignored) |
| `dist-dashboard/` folder | **Upload to Puter** | New build for website |
| Puter URL | **Keep same** | `https://onextap.puter.site` |
| Puter files | **Replace with new build** | Upload from `dist-dashboard/` |

## 🎯 Quick Answer

1. **`dist/` in workspace**: Keep it (it's git-ignored, contains extension build)
2. **Puter files**: Yes, delete old files and upload new ones from `dist-dashboard/`
3. **Puter URL**: Keep the same - `https://onextap.puter.site` (no change needed)

Both build outputs are now in `.gitignore`, so they won't clutter your git repository! 🎉
