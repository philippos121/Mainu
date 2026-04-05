# AI:ssociate — AppSource Submission Guide

## Overview

This folder contains everything needed to submit the AI:ssociate Word plugin
to the Microsoft Office Store (AppSource) via Partner Center.

---

## Pre-submission Checklist

### 1. Partner Center Account
- [ ] Create account at https://partner.microsoft.com
- [ ] Complete identity verification (business or individual)
- [ ] Pay one-time $19 registration fee (if applicable)

### 2. Required Assets (in this folder)

| File | Purpose | Status |
|------|---------|--------|
| `listing.md` | Store listing text (title, descriptions, features) | Ready |
| `manifest-appstore.xml` | AppSource-compliant manifest | Ready |
| `privacy-policy.html` | Privacy policy page (hosted on Render) | Ready |
| `terms-of-use.html` | Terms of use page (hosted on Render) | Ready |
| `SCREENSHOTS.md` | Guide for required screenshots | Ready |

### 3. Screenshots You Need to Capture
AppSource requires **at least 1 screenshot** (recommended 5). See `SCREENSHOTS.md` for exactly what to capture.

### 4. Icon Requirements
- [ ] 128x128 px icon (PNG, for the store listing)
- [ ] 64x64 px icon (already have: `assets/icon-64.png`)
- [ ] 32x32 px icon (already have: `assets/icon-32.png`)

You need to create a **128x128** version of your logo for the store listing.

---

## Submission Steps

### Step 1: Prepare the Render deployment
Make sure your app is live and stable at:
```
https://aissociate-word-plugin.onrender.com
```

Verify these URLs load correctly:
- `/taskpane.html` — the plugin UI
- `/manifest.xml` — the manifest
- `/privacy.html` — privacy policy
- `/terms.html` — terms of use

### Step 2: Go to Partner Center
1. Sign in at https://partner.microsoft.com/dashboard
2. Go to **Marketplace offers** > **Office add-ins**
3. Click **+ New offer** > **Office add-in**

### Step 3: Fill in the listing

Use the text from `listing.md` to fill in:
- **App name**: AI:ssociate - Legal AI Assistant
- **Short description** (100 chars max)
- **Long description** (10,000 chars max)
- **Screenshots** (see SCREENSHOTS.md)
- **Support URL**: your Render URL
- **Privacy policy URL**: `https://aissociate-word-plugin.onrender.com/privacy.html`
- **Terms of use URL**: `https://aissociate-word-plugin.onrender.com/terms.html`

### Step 4: Upload the manifest
Upload `manifest-appstore.xml` from this folder.

### Step 5: Submit for review
- Microsoft reviews within **1-2 weeks**
- Common rejection reasons and fixes are listed at the bottom of `listing.md`

---

## After Approval
Once approved, users worldwide can find your plugin by:
1. Opening Word
2. Going to **Insert** > **Get Add-ins**
3. Searching for **"AI:ssociate"**
4. Clicking **Add**
