# FinSight: Financial Health & Proactive Cash-Flow Planner

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![GCP Native](https://img.shields.io/badge/Google%20Cloud-Firestore%20%7C%20Compute%20Engine%20%7C%20Ops%20Agent-blue.svg)](https://cloud.google.com/)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen.svg)]()
[![License](https://img.shields.io/badge/License-MIT-purple.svg)]()

> *"Where might my money go next, and what can I change before it happens?"*

**FinSight** is a predictive FinTech platform designed to help users anticipate cash-flow trends, safeguard emergency reserves, and test financial commitments *before* making them.

---

## 🌟 Key Capabilities

1. **Intelligent Cash-Flow Forecasting (7 / 30 / 60 Days)**
   - Day-by-day projected balance factoring logged transactions, moving average daily spending, and upcoming recurring bills.
   - Automatic warnings for **cash shortfall dates** ($balance < 0$) and **reserve threshold breaches**.
   - **Confidence Corridor**: Dual-envelope projection displaying both optimistic (+15% savings) and stressed (+25% inflation/accidental leaks) trajectories.

2. **What-If Decision Simulator**
   - Stress-test financial choices before committing funds (e.g. buying a ₹40,000 item, an emergency repair in 10 days, or a delayed paycheck).
   - Instant verdicts (*"Looks affordable"*, *"Reserve breach"*, or *"High deficit risk"*) with side-by-side comparative tables and visual SVG curves.

3. **Financial Health Score & Cash Runway**
   - **Health Score (0–100 & Grades A+ to D)**: Multi-factor scoring evaluating reserve adequacy, runway, solvency, and liquidity buffer.
   - **Cash Runway (Months)**: Measures how long liquid funds last against monthly non-discretionary burn if income stops tomorrow.

4. **Category Spending Analytics**
   - 30-day spending distribution breakdown across categories (Groceries, Transit, Dining, Healthcare, Utilities).

5. **Multi-Frequency Recurrence Engine**
   - Native support for **Weekly**, **Bi-weekly** (alternate weeks), **Monthly**, **Quarterly**, **Yearly**, and **One-time** obligations.

6. **CSV Statement Import & Export**
   - One-click export of financial records and bulk CSV file import for bank / UPI statements.

7. **Zero-Dependency Interactive SVG Charts**
   - Pure vector chart rendering with crosshairs, hover tooltips, and reserve guides without bloated external visualization libraries.

---

## 🏗️ Architecture

```
Browser (HTML5 / Vanilla JS)
       │
       ▼
Nginx Reverse Proxy (Web Port 80 / 443)
       │
       ├────► Serves Static Web Assets (/var/www/finsight)
       │
       └────► Reverse Proxies /api Requests
                 │
                 ▼
          Node.js / Express API (Port 8080)
                 │
                 ├─► Local Dev Mode: In-Memory Fast Mock (USE_MEMORY=1)
                 │
                 └─► Production: Cloud Firestore Native (@google-cloud/firestore)
```

### Repository Structure
```
FinSight/
├── frontend/                 # Client UI & Client-Side Engine
│   ├── index.html            # Single-page interface layout
│   ├── style.css             # Responsive styling & theme
│   ├── app.js                # DOM orchestration, SVG chart renderer & API client
│   └── forecast.js           # Pure math calculation & health scoring engine
├── backend/                  # Server API
│   ├── server.js             # Express API with security headers & rate limiting
│   ├── package.json          # Node dependencies & test scripts
│   └── test/                 # Automated Test Suite
│       ├── forecast.test.js  # Math & recurrence algorithm tests
│       └── server.test.js    # API route integration tests
├── deploy/                   # Cloud Deployment & Provisioning
│   ├── nginx.conf            # Nginx server block configuration
│   ├── finsight.service      # Systemd background service daemon
│   ├── ops-agent.yaml        # Google Cloud Logging & Monitoring telemetry
│   └── setup.sh              # Automated provisioning script for Debian 12
├── .github/
│   └── workflows/ci.yml      # Automated GitHub Actions test pipeline
├── .gitignore
├── package.json              # Root workspace scripts
└── README.md
```

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 18+ installed

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Run Automated Test Suite
All calculations and endpoints are verified via Node.js native test runner:
```bash
npm test
```

### 3. Run Locally (Zero Cloud Setup Needed)
Run in in-memory mode:
```bash
npm run dev
# Or: USE_MEMORY=1 node server.js
```
Open **http://localhost:8080** in your browser and click **"Load demo data"**.

---

## ☁️ Google Cloud Platform Deployment

### Step 1: Initialize GCP Environment
```bash
gcloud auth login
export PROJECT_ID=YOUR_PROJECT_ID
export REGION=asia-south1
export ZONE=asia-south1-b
gcloud config set project $PROJECT_ID
```

### Step 2: Enable Required APIs
```bash
gcloud services enable compute.googleapis.com firestore.googleapis.com logging.googleapis.com monitoring.googleapis.com
```

### Step 3: Create Firestore Database
```bash
gcloud firestore databases create --location=$REGION --type=firestore-native
```

### Step 4: Provision Least-Privilege Service Account
```bash
gcloud iam service-accounts create finsight-vm-sa --display-name="FinSight VM SA"
SA=finsight-vm-sa@$PROJECT_ID.iam.gserviceaccount.com

for ROLE in roles/datastore.user roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$SA --role=$ROLE
done
```

### Step 5: Network & Firewall Setup
```bash
# Create custom VPC and subnet
gcloud compute networks create finsight-vpc --subnet-mode=custom
gcloud compute networks subnets create finsight-subnet --network=finsight-vpc --region=$REGION --range=10.10.0.0/24

# Allow web traffic (HTTP/HTTPS)
gcloud compute firewall-rules create finsight-allow-web --network=finsight-vpc \
  --allow=tcp:80,tcp:443 --target-tags=finsight-web --source-ranges=0.0.0.0/0

# Allow SSH from your IP only (replace with your public IP)
gcloud compute firewall-rules create finsight-allow-ssh --network=finsight-vpc \
  --allow=tcp:22 --target-tags=finsight-web --source-ranges=YOUR_IP/32
```

### Step 6: Launch Compute Engine VM
```bash
gcloud compute instances create finsight-vm \
  --zone=$ZONE --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --network=finsight-vpc --subnet=finsight-subnet \
  --tags=finsight-web \
  --service-account=$SA --scopes=cloud-platform
```

### Step 7: Deploy Code & Execute Setup
From the root of your `FinSight` project:
```bash
gcloud compute scp --recurse . finsight-vm:~/finsight --zone=$ZONE
gcloud compute ssh finsight-vm --zone=$ZONE --command="cd finsight && sudo bash deploy/setup.sh"
```

### Step 8: Access the Application
Get your VM's public IP:
```bash
gcloud compute instances describe finsight-vm --zone=$ZONE \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```
Visit `http://<EXTERNAL_IP>` in your browser.

---

## 🔒 Security & Data Hygiene
- Input sanitization and bounds checking on all monetary values and date strings.
- In-memory rate limiting to throttle excessive requests.
- Security response headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`).
- Synthetic data only in demo mode — avoid entering real bank credentials.
