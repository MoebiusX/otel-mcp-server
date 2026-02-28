# GoAlert On-Call Setup Guide

Quick-start guide for configuring incident management and phone notifications.

## 🚀 Access

**GoAlert UI:** http://localhost:8081

## 📋 Initial Setup (First Time Only)

1. **Open GoAlert UI** → First-time setup wizard appears
2. **Create Admin Account**
   - Username: `carlos` (or your preference)
   - Password: (choose a secure password)
   - Email: `carlos@krystaline.io`

## 🛠️ Configuration Steps

### Step 1: Add Contact Methods
1. Go to **Profile** → **Contact Methods**
2. Add phone number for SMS/voice alerts
3. Add email for backup notifications

### Step 2: Create a Service
1. Go to **Services** → **Create New Service**
2. Name: `KrystalineX Production`
3. Description: `Primary crypto exchange platform`

### Step 3: Create Escalation Policy
1. Go to **Escalation Policies** → **Create**
2. Name: `Primary On-Call`
3. Add steps:
   - Step 1 (0 min delay): Notify primary on-call user
   - Step 2 (15 min delay): Notify backup user
   - Step 3 (30 min delay): Notify entire team

### Step 4: Create Integration Key
1. Open your Service → **Integration Keys** tab
2. Click **Create Integration Key**
3. Type: `Generic API`
4. Copy the key (looks like: `abc123def456...`)

### Step 5: Connect Alertmanager
Create the token file:
```bash
echo "YOUR_INTEGRATION_KEY" > config/alertmanager/goalert-token
```

Restart alertmanager to pick up the token:
```bash
docker-compose restart alertmanager
```

## 📱 Phone Notifications (Twilio)

To enable SMS/Voice calls:

1. **Create Twilio Account** → https://www.twilio.com
2. **Get Credentials:**
   - Account SID
   - Auth Token
   - Twilio Phone Number
3. **Configure GoAlert:**
   - Go to **Admin** → **Config**
   - Set Twilio credentials

## 🧪 Test Alerts

### Fire a Test Alert via curl:
```powershell
curl -X POST http://localhost:8081/api/v2/generic/incoming `
  -H "Authorization: Bearer YOUR_INTEGRATION_KEY" `
  -H "Content-Type: application/json" `
  -d '{"summary":"Test Alert","details":"Testing oncall notification"}'
```

### Or trigger via Alertmanager:
Alerts from Prometheus rules will automatically route through Alertmanager → GoAlert.

## 📂 Files

| File | Purpose |
|------|---------|
| `config/alertmanager.yml` | Routes critical alerts to GoAlert webhook |
| `config/alertmanager/goalert-token` | Integration key (create this) |
| `docker-compose.yml` | GoAlert + PostgreSQL services |

## 🔗 Integration Flow

```
Prometheus → Alertmanager → GoAlert → Phone/SMS/Email
     ↓              ↓
  (rules)    (carlos@krystaline.io)
```

## 🚨 Alert Routing (Current Config)

- **Critical alerts** → GoAlert + Email
- **Warning alerts** → GoAlert only
- **Security alerts** → GoAlert (high priority)

---

**Need help?** GoAlert docs: https://goalert.me/docs
