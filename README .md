# FinSight: Financial Health & Cash-Flow Planner

Track income and expenses, forecast balances for 7/30/60 days, and test a purchase before making it.

```
Browser (HTML/CSS/JS)  ->  Nginx on Compute Engine VM  ->  Node/Express API  ->  Cloud Firestore
                             (serves site, proxies /api)      (localhost:8080)
```

| Folder | What it is |
|---|---|
| `frontend/` | Website. `forecast.js` holds the calculations (forecast, safe-to-spend, What-If). |
| `backend/` | Express API (`server.js`) that validates input and stores records in Firestore. |
| `deploy/` | Nginx config, systemd service, Ops Agent config, `setup.sh`. |

---

## 1. Run it on your laptop first (no Google Cloud needed)

Needs Node.js 18+.

```bash
cd backend
npm install
USE_MEMORY=1 node server.js        # Windows PowerShell:  $env:USE_MEMORY=1; node server.js
```

Open http://localhost:8080 and click **Load demo data**. Data lives in memory and resets when you stop the server.

---

## 2. Deploy to Google Cloud

Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install), then log in.
Replace `YOUR_PROJECT_ID` and `YOUR_IP` (find it by searching "what is my ip").

```bash
gcloud auth login
export PROJECT_ID=YOUR_PROJECT_ID
export REGION=asia-south1
export ZONE=asia-south1-b
gcloud config set project $PROJECT_ID
```

### Step 1: Billing alert first
Console -> Billing -> **Budgets & alerts** -> Create budget (for example 500 INR, alerts at 50%, 90%, 100%).
A budget only sends alerts; it does not stop spending.

### Step 2: Enable APIs
```bash
gcloud services enable compute.googleapis.com firestore.googleapis.com logging.googleapis.com monitoring.googleapis.com
```

### Step 3: Create the Firestore database
```bash
gcloud firestore databases create --location=$REGION --type=firestore-native
```

### Step 4: Service account for the VM (least privilege)
```bash
gcloud iam service-accounts create finsight-vm-sa --display-name="FinSight VM"
SA=finsight-vm-sa@$PROJECT_ID.iam.gserviceaccount.com
for ROLE in roles/datastore.user roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$SA --role=$ROLE
done
```

### Step 5: VPC and firewall rules
```bash
gcloud compute networks create finsight-vpc --subnet-mode=custom
gcloud compute networks subnets create finsight-subnet --network=finsight-vpc --region=$REGION --range=10.10.0.0/24

# Public web traffic
gcloud compute firewall-rules create finsight-allow-web --network=finsight-vpc \
  --allow=tcp:80,tcp:443 --target-tags=finsight-web --source-ranges=0.0.0.0/0

# SSH only from your own IP
gcloud compute firewall-rules create finsight-allow-ssh --network=finsight-vpc \
  --allow=tcp:22 --target-tags=finsight-web --source-ranges=YOUR_IP/32
```

### Step 6: Create the VM
```bash
gcloud compute instances create finsight-vm \
  --zone=$ZONE --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --network=finsight-vpc --subnet=finsight-subnet \
  --tags=finsight-web \
  --service-account=$SA --scopes=cloud-platform
```
Check the current e2-micro price for your region before creating it.

### Step 7: Copy the project and run setup
Run these from the folder that **contains** `finsight/` (delete `finsight/backend/node_modules` first if you ran it locally):
```bash
gcloud compute scp --recurse finsight finsight-vm:~ --zone=$ZONE
gcloud compute ssh finsight-vm --zone=$ZONE --command="cd finsight && sudo bash deploy/setup.sh"
```

### Step 8: Open the site
```bash
gcloud compute instances describe finsight-vm --zone=$ZONE \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```
Visit `http://<that IP>` and click **Load demo data**.

To deploy code changes later, copy the folder again and re-run `deploy/setup.sh`.

---

## 3. Show your cloud skills (for the demo)

| Proof | Where |
|---|---|
| VM running | Console -> Compute Engine -> VM instances |
| Firewall rules | Console -> VPC network -> Firewall |
| IAM (least privilege) | Console -> IAM -> `finsight-vm-sa` has only 3 roles |
| Data | Console -> Firestore -> collections starting with `finsight_` |
| Logs | Console -> Logging -> Logs Explorer (nginx access log + `/var/log/finsight/app.log`) |
| Monitoring | Console -> Monitoring -> Dashboards -> VM Instance (CPU, network) |
| Billing budget | Console -> Billing -> Budgets & alerts |

## 4. Optional: HTTPS
HTTPS needs a domain name. Point an A record at the VM's IP (ideally reserve a static IP first), then on the VM:
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

## 5. Clean up (stop all charges)
Stopping a VM does not stop disk or reserved-IP charges. Delete everything when done:
```bash
gcloud compute instances delete finsight-vm --zone=$ZONE
gcloud compute firewall-rules delete finsight-allow-web finsight-allow-ssh
gcloud compute networks subnets delete finsight-subnet --region=$REGION
gcloud compute networks delete finsight-vpc
gcloud iam service-accounts delete $SA
```
Delete the Firestore database and the project from the Console if you no longer need them.

## Notes
- This demo has one shared "demo" user and no login. Anyone with the URL can see and edit the data, so use synthetic data only. Adding Firebase Authentication per user is the natural next step.
- Fraud detection is out of scope for this version.
