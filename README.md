# Bansil Books Analytics — Phase 0: Zoho Connection Test

A small local web application that validates Zoho Books connectivity by fetching today's Sales Invoices and Purchase Bills.

**Purpose:** Phase 0 validation only. Does NOT write, modify, or delete anything in Zoho Books.

---

## Prerequisites

- **Node.js** 18 or higher  
  Check: `node --version`
- **npm** (comes with Node.js)
- A **Zoho Books** account (India data center)

---

## Step 1 — Create a Zoho API Application

1. Go to **https://api-console.zoho.in** (use `.in` if your Zoho account is India)
2. Sign in with your Zoho account
3. Click **"Add Client"**
4. Choose **"Server-based Applications"**
5. Fill in:
   - **Client Name:** `Bansil Books Analytics Test` (or any name)
   - **Homepage URL:** `http://localhost:3000`
   - **Authorized Redirect URIs:** `http://localhost:3000/api/zoho/callback`
6. Click **Create**
7. You will now see your **Client ID** and **Client Secret** — copy both

---

## Step 2 — Configure Credentials

In the `bansil-books-zoho-test/` folder, create a file named `.env.local`:

```
ZOHO_CLIENT_ID=your_client_id_here
ZOHO_CLIENT_SECRET=your_client_secret_here
ZOHO_REDIRECT_URI=http://localhost:3000/api/zoho/callback
ZOHO_ACCOUNTS_URL=https://accounts.zoho.in
```

Replace `your_client_id_here` and `your_client_secret_here` with the values from Step 1.

> ⚠️ Never share `.env.local` with anyone. It is excluded from Git automatically.

---

## Step 3 — Install Dependencies

Open Terminal, navigate to this folder, and run:

```bash
cd /Users/balkrishnapjoshi/Documents/Antigravity/bansil-books-zoho-test
npm install
```

---

## Step 4 — Start the Application

```bash
npm run dev
```

The app starts at **http://localhost:3000**

---

## Step 5 — Connect Zoho Books

1. Open **http://localhost:3000** in your browser
2. Click **"Connect Zoho Books"**
3. You will be redirected to Zoho's login/authorization page
4. Sign in with your Zoho account
5. Review the permissions (read-only: Settings, Invoices, Bills)
6. Click **Accept**
7. You will be redirected back to the app automatically

---

## Step 6 — Select Your Organization

- If you have **one** Zoho Books organization, it will be selected automatically.
- If you have **multiple** organizations, a dropdown will appear — select the correct one and click **Confirm**.

---

## Step 7 — View Today's Data

After connecting and selecting an organization, the app will automatically fetch:

- **Today's Sales Invoices** (by invoice date, IST)
- **Today's Purchase Bills** (by bill date, IST)

You can click **"Refresh Today's Data"** at any time to re-fetch.

---

## Step 8 — Verify Totals

Compare the totals shown on screen with what you see in Zoho Books:

1. In Zoho Books → go to **Sales → Invoices** → filter by today's date
2. Compare the count and total with the app
3. In Zoho Books → go to **Purchases → Bills** → filter by today's date
4. Compare the count and total with the app
5. Once verified, check the box: **"I have verified these totals in Zoho Books"**
6. The status changes to **PHASE 0 VALIDATION PASSED** ✅

---

## Stop the Server

Press `Ctrl + C` in the Terminal window where `npm run dev` is running.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Missing ZOHO_CLIENT_ID" | Check that `.env.local` exists and has the correct values |
| "Zoho authorization failed" | Make sure the Redirect URI in Zoho API Console exactly matches `http://localhost:3000/api/zoho/callback` |
| "Token expired" | Click Refresh — the app will auto-refresh. If it fails, click "Disconnect" and reconnect |
| No invoices/bills shown | This is normal if there are no transactions dated today. Check the date shown in the app. |
| Port 3000 already in use | Run `npm run dev -- --port 3001` and update `ZOHO_REDIRECT_URI` accordingly |

---

## Security Notes

- This app is **local only** — it never sends data to any external server except Zoho's own APIs
- Tokens are stored in `.tokens.json` in this folder (git-ignored, never uploaded)
- Your Client Secret is never sent to the browser — it stays server-side only
- Only **read-only** Zoho scopes are requested: no writes are possible

---

## Exact Redirect URI

```
http://localhost:3000/api/zoho/callback
```

This must be added **exactly** (including `http://`) in the Zoho API Console under your client's **Authorized Redirect URIs**.
