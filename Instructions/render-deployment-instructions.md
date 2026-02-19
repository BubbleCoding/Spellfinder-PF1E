# Deploying Spellfinder to Render

## Overview

Render's free tier supports Python web services. The app will be publicly accessible at a URL like `https://spellfinder-pf1e.onrender.com`. The free tier spins down after 15 minutes of inactivity — the first visit after that will take ~30 seconds to wake up, which is acceptable for a hobby project.

**Important limitation:** Render's free tier has ephemeral storage — the SQLite database is wiped on every deploy and every spin-down/restart. This means:
- Spell data rebuilds automatically on each startup (fine, it comes from the CSV download)
- Spellbooks stored in the DB will not persist — this is exactly why the key export/import feature was implemented first

---

## Step 1 — Prepare the repo

### 1a. Add `gunicorn` to `requirements.txt`

Render needs a production WSGI server. Open `requirements.txt` and add:

```
flask
gunicorn
openpyxl
```

(Add `openpyxl` if it isn't already there — it's needed for the spirit/mystery import.)

### 1b. Create a `Procfile` in the repo root

Create a file named exactly `Procfile` (no extension) with this content:

```
web: gunicorn app:app
```

### 1c. Create a `render.yaml` in the repo root (optional but recommended)

This tells Render how to build and run the app automatically:

```yaml
services:
  - type: web
    name: spellfinder-pf1e
    runtime: python
    buildCommand: "pip install -r requirements.txt && python init_db.py && python categorization/import_categories.py"
    startCommand: "gunicorn app:app"
    plan: free
```

If you include `render.yaml`, Render will pick up the configuration automatically when you connect the repo.

### 1d. Commit and push everything to GitHub

```bash
git add requirements.txt Procfile render.yaml
git commit -m "Add Render deployment config"
git push
```

---

## Step 2 — Create a Render account and deploy

1. Go to [render.com](https://render.com) and sign up (you can use your GitHub account)
2. From the dashboard, click **New → Web Service**
3. Click **Connect a repository** and authorize Render to access your GitHub
4. Select the `Spellfinder-PF1E` repository
5. Render will detect the `render.yaml` and pre-fill the settings. If not, fill them in manually:

| Field | Value |
|---|---|
| **Name** | spellfinder-pf1e (or whatever you like) |
| **Runtime** | Python 3 |
| **Build Command** | `pip install -r requirements.txt && python init_db.py && python categorization/import_categories.py` |
| **Start Command** | `gunicorn app:app` |
| **Plan** | Free |

6. Click **Create Web Service**

Render will now build and deploy the app. The first build takes 2–5 minutes. You can watch the logs in real time on the dashboard.

---

## Step 3 — Verify the deployment

Once the build finishes, Render gives you a public URL (e.g. `https://spellfinder-pf1e.onrender.com`). Open it — the app should load and be fully functional.

If something goes wrong, check the **Logs** tab on the Render dashboard for error output.

---

## Step 4 — Set up automatic deploys (already on by default)

By default, Render automatically redeploys every time you push to the `main` branch on GitHub. No action needed — just keep developing and pushing as normal.

---

## Notes

### Cold starts
The free tier service sleeps after 15 minutes of no traffic. The next visitor will wait ~30 seconds for it to wake. There is no way around this on the free plan — it's the trade-off for $0/month.

### The spirit and mystery import
The build command runs `import_spirit_mystery.py` is intentionally excluded because it requires `spirit and mystery.xlsx` to be present in the repo. Since that file is committed to the repo, you can add it to the build command if you want that data available:

```
pip install -r requirements.txt && python init_db.py && python categorization/import_categories.py && python categorization/import_spirit_mystery.py
```

### If you later want persistent spellbooks
The free fix is to replace SQLite with a free external Postgres database. Render itself offers a free Postgres instance (90-day limit), or you can use [Supabase](https://supabase.com) which has a permanent free tier. This would require replacing the SQLite calls in `app.py` with `psycopg2` calls — a bigger change, but straightforward if you ever need it.
