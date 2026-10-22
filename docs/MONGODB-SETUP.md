# MongoDB Atlas Integration Guide

This document describes how to configure, secure, and test the MongoDB Atlas connection for the ABG Tracker V2 application.

---

## 1. Security Architecture

1. **Server-Only Access**:
   - `MONGODB_URI` is strictly private to the server runtime.
   - It is never prefixed with `VITE_` and is never bundled into client assets or served via public endpoints.
   - Log outputs automatically redact username and password credentials.

2. **Independence from PostgreSQL**:
   - `MONGODB_URI` is decoupled from `DATABASE_URL`.
   - The PostgreSQL / PGlite data layer remains fully operational and untampered during this migration phase.

3. **Safe Fallback**:
   - When `MONGODB_URI` is unset, the application boots normally using existing storage without error or degradation.

---

## 2. Obtaining the Connection String from MongoDB Atlas

1. Log in to [MongoDB Atlas](https://cloud.mongodb.com/).
2. In the **Database Deployments** screen, click **Connect** on your cluster.
3. Select **Drivers** under "Connect your application".
4. Ensure Driver is set to **Node.js** (version 5.5 or later).
5. Copy the connection string format:
   ```text
   mongodb+srv://<username>:<password>@<cluster-url>/<dbname>?retryWrites=true&w=majority
   ```
6. Replace `<username>` and `<password>` with your Atlas database user credentials.
7. Replace `<dbname>` with your target database (default: `abg_tracker`).

---

## 3. Network Access (IP Whitelist)

1. In the Atlas dashboard, navigate to **Security** → **Network Access**.
2. Click **Add IP Address**.
3. For containerized Cloud Run deployments, add your Cloud NAT / static egress IP, or allow access from anywhere (`0.0.0.0/0`) if protected by strong database credentials.
4. For local testing, add your current public IP address.

---

## 4. Setting `MONGODB_URI` in Server Environments

### A. Local Development (`.env`)
Add the following line to your local `.env` file (ensure `.env` is git-ignored):
```bash
MONGODB_URI="mongodb+srv://naveenkumarkuppan_db_user:<your_actual_password>@abgtracker.lmjxmzf.mongodb.net/abg_tracker?retryWrites=true&w=majority"
```

### B. Google Cloud Run / Production
Set `MONGODB_URI` via Google Secret Manager or directly in the Cloud Run service environment:
```bash
gcloud run services update abg-v2 \
  --set-env-vars="MONGODB_URI=mongodb+srv://naveenkumarkuppan_db_user:<your_actual_password>@abgtracker.lmjxmzf.mongodb.net/abg_tracker?retryWrites=true&w=majority"
```

### C. Docker / Docker Compose
Pass `MONGODB_URI` in `docker-compose.yml` or via `--env`:
```yaml
environment:
  - MONGODB_URI=${MONGODB_URI}
```

---

## 5. Testing the Connection

A diagnostic script is provided to verify connectivity, measure latency, and validate credentials without running the full application server:

```bash
# Run connection verification
MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<dbname>?retryWrites=true&w=majority" npx tsx scripts/test-mongodb.ts
```

### Expected Output:
```text
--- ABG Tracker V2: MongoDB Atlas Connectivity Diagnostic ---
Connecting to: mongodb+srv://****:****@cluster0.abcde.mongodb.net/abg_tracker
Connection established in 184ms.
Atlas cluster ping response: { ok: 1 }
Selected target database: "abg_tracker"
Existing collections (0): []
MongoDB Atlas connection verification SUCCEEDED.
```
