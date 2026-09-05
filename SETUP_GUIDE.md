# MG Attendance AI Face Recognition — Complete Setup & Deployment Guide

This document provides complete instructions for setting up, developing, deploying, and maintaining the **MG Attendance AI Face Recognition System** in both **Local Development / Edge Kiosk PC** and **Cloud / Production Server** environments.

---

## Table of Contents
1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Hardware & Software Prerequisites](#2-hardware--software-prerequisites)
3. [Local Development Setup (For Developers)](#3-local-development-setup-for-developers)
4. [Edge Kiosk PC Deployment (Single-PC Turnkey Station)](#4-edge-kiosk-pc-deployment-single-pc-turnkey-station)
5. [Production Cloud Deployment (Custom Domain & Named Cloudflare Tunnel)](#5-production-cloud-deployment-custom-domain--named-cloudflare-tunnel)
6. [Headless Linux / VPS Production Server Setup](#6-headless-linux--vps-production-server-setup)
7. [Email Notifications & SMTP Configuration](#7-email-notifications--smtp-configuration)
8. [Mobile App Setup (Student & Guardian Portal)](#8-mobile-app-setup-student--guardian-portal)
9. [Database Backup & Maintenance](#9-database-backup--maintenance)
10. [Troubleshooting & Frequently Asked Questions](#10-troubleshooting--frequently-asked-questions)

---

## 1. System Overview & Architecture

MG Attendance is an enterprise-ready contactless facial recognition attendance kiosk and administrative management platform.

```
                  +----------------------------------------------+
                  |               PHYSICAL KIOSK                 |
                  |                                              |
                  |   Webcam ---> OpenCV / AI Pipeline (Py)      |
                  |                      |                       |
                  |             WebSocket / Fast-API             |
                  |                      |                       |
                  |       Chromium Kiosk Display (/kiosk)        |
                  +----------------------+-----------------------+
                                         |
                                         v
                         +-------------------------------+
                         |     Cloudflare Zero Trust     |
                         |   Encrypted Outbound Tunnel   |
                         +---------------+---------------+
                                         |
              +--------------------------+--------------------------+
              |                                                     |
              v                                                     v
+-----------------------------+                       +-----------------------------+
|    Remote Admin Portal      |                       |    Student Mobile App       |
|  (https://attendance.org)   |                       |    (React Native / Expo)    |
|   Dashboard, DTR, Reports   |                       |    QR Pass, Real-Time DTR   |
+-----------------------------+                       +-----------------------------+
```

### Key Components:
- **Backend (`backend/`)**: Built on FastAPI, OpenCV, InsightFace/DeepFace, and SQLite. Processes live camera frames, runs anti-spoofing and liveness detection, matches embeddings, logs Daily Time Records (DTR), and dispatches automated parent notification emails.
- **Frontend (`frontend/`)**: React 19 single-page application bundled with Vite and Tailwind CSS. Provides both the kiosk camera stage and the admin dashboard.
- **Tunneling**: Cloudflare Zero Trust tunnel enables secure inbound remote access without port forwarding or public IP requirements.
- **Mobile (`mobile/`)**: Cross-platform Expo/React Native student app for viewing real-time attendance, digital ID, and entry/exit history.

---

## 2. Hardware & Software Prerequisites

### Kiosk Station Hardware
| Component | Minimum Specification | Recommended Specification |
| :--- | :--- | :--- |
| **Processor** | Intel Core i3 / AMD Ryzen 3 (4 cores) | Intel Core i5 / AMD Ryzen 5 or higher |
| **RAM** | 8 GB | 16 GB DDR4/DDR5 |
| **Storage** | 20 GB free space (SSD recommended) | 50 GB+ SSD |
| **Camera** | 720p USB Webcam (30 FPS) | 1080p USB Webcam with wide angle & good low-light sensitivity |
| **Display** | 1080p monitor | 1080p or 4K touchscreen monitor |

### Software Prerequisites
- **Operating System**: Windows 10/11 (64-bit) or Ubuntu 22.04+ LTS.
- **Python**: **Version 3.10 or 3.11** (64-bit).
  > [!IMPORTANT]
  > During Python installation, you **must** check the box: **"Add Python to PATH"**.
- **Node.js**: Version 18 LTS or 20 LTS (required only on developer machines to build the frontend; not required on pure Kiosk machines if using pre-built `frontend/dist`).
- **Web Browser**: Google Chrome or Microsoft Edge (comes pre-installed on Windows).
- **Git**: Git for Windows (for cloning and updating code).

---

## 3. Local Development Setup (For Developers)

Follow these steps on your workstation to run the system with hot-reloading for development.

### Step 1: Clone the Repository
```bash
git clone https://github.com/YourOrg/Attendance-AI-face.git
cd Attendance-AI-face
```

### Step 2: Configure Python Virtual Environment
```bash
cd backend
python -m venv .venv

# On Windows PowerShell:
.venv\Scripts\Activate.ps1
# Or Windows Command Prompt:
.venv\Scripts\activate.bat
# On Linux/macOS:
source .venv/bin/activate

# Upgrade pip and install backend dependencies
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### Step 3: Run First-Time AI Model Setup
Start the server once to allow DeepFace/InsightFace to automatically download model weights into your user cache (`~/.deepface/weights`):
```bash
python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```
Once you see `Application startup complete`, press `Ctrl + C` to stop.

### Step 4: Configure & Run the Frontend Development Server
In a separate terminal window:
```bash
cd frontend
npm install
npm run dev
```
The Vite development server runs on `http://localhost:5173`. It automatically proxies API requests (`/api/*`) and WebSockets (`/ws`) to `http://localhost:8000`.

- **Developer Dashboard URL**: `http://localhost:5173/`
- **Developer Kiosk Display**: `http://localhost:5173/kiosk`
- **Default Admin Login**:
  - Username: `admin`
  - Password: `admin123` *(change upon first login)*

---

## 4. Edge Kiosk PC Deployment (Single-PC Turnkey Station)

In an on-campus or office deployment, the PC connected to the kiosk webcam runs both the AI recognition backend and the interactive kiosk screen.

### Step 1: Initial PC Setup
1. Install **Python 3.10 or 3.11** (Ensure "Add Python to PATH" is checked).
2. Install **Google Chrome** or **Microsoft Edge**.
3. Connect the USB Webcam and verify video functionality in the Windows Camera app.
4. Clone or copy the repository to a permanent location (e.g. `C:\MG-Attendance` or `D:\MG-Attendance`).

### Step 2: Build the Frontend (One Time)
If not already built, open PowerShell inside the project directory:
```bash
cd frontend
npm install
npm run build
```
This bundles the production application into `frontend/dist/`. The FastAPI backend will automatically serve both `/` and `/kiosk` from this folder without needing Node.js or `npm run dev`.

### Step 3: Starting the Kiosk
The repository contains 1-click startup batch scripts in the project root:

| Script | Purpose |
| :--- | :--- |
| `start_kiosk.bat` | Starts the backend server minimized and opens the kiosk screen locally in fullscreen mode. Perfect for offline or local-only stations. |
| `start_kiosk_with_tunnel.bat` | Starts the backend, activates an outbound Cloudflare tunnel, prints the public URL, and opens the kiosk screen. |
| `stop_kiosk.bat` | 1-Click shutdown that cleanly terminates the browser, backend server, and any running tunnel. |

Simply **double-click** `start_kiosk.bat` (or `start_kiosk_with_tunnel.bat`).

### Step 4: Kiosk Screen Controls & Navigation
- **Exit / Enter Fullscreen**: Press <kbd>F11</kbd> at any time to toggle fullscreen mode on or off.
- **Switch to Admin Dashboard**: Click the **Admin Portal** button in the top-right header of the kiosk display, or navigate to `http://localhost:8000/`.
- **Return to Kiosk**: Click **Enter Kiosk** from the Admin Dashboard sidebar.
- **Close Window**: Press <kbd>Alt</kbd> + <kbd>F4</kbd> or run `stop_kiosk.bat`.

### Step 5: Windows Auto-Start on System Boot
To configure the kiosk station to automatically boot up and launch when the PC turns on:

1. Press <kbd>Win</kbd> + <kbd>R</kbd>, type `shell:startup`, and press **Enter**.
2. Right-click inside the startup folder &rarr; **New** &rarr; **Shortcut**.
3. In the location box, enter:
   ```cmd
   cmd.exe /c "cd /d C:\MG-Attendance && start_kiosk.bat"
   ```
   *(Replace `C:\MG-Attendance` with your actual repository path).*
4. Click **Next**, name the shortcut `MG Attendance AutoStart`, and click **Finish**.
5. Enable Windows auto-login for your kiosk user account using `netplwiz` so the PC boots straight to the desktop without waiting at the Windows lock screen.

---

## 5. Production Cloud Deployment (Custom Domain & Named Cloudflare Tunnel)

Free `trycloudflare.com` quick tunnels produce a randomized URL each time the computer reboots. For school admins, teachers, and students to access the portal at a permanent web address (e.g. `https://attendance.yourschool.edu`), set up a **Cloudflare Zero Trust Named Tunnel**.

### Step 1: Prerequisites
1. A free [Cloudflare](https://dash.cloudflare.com/) account.
2. A domain name active on Cloudflare (e.g., `yourschool.edu` or a cheap domain from Namecheap / Cloudflare Registrar).
3. Download `cloudflared.exe` from [Cloudflare Releases](https://github.com/cloudflare/cloudflared/releases) and place it in `C:\Windows\System32\` (or in `backend/downloads/cloudflared.exe`).

### Step 2: Authenticate Cloudflared
Open PowerShell or Command Prompt as Administrator:
```bash
cloudflared tunnel login
```
A browser window will open. Select your domain to authorize the connection. A certificate file will be saved to `~/.cloudflared/cert.pem`.

### Step 3: Create the Named Tunnel
Run:
```bash
cloudflared tunnel create mg-attendance
```
This generates a **Tunnel ID** (e.g., `8f6417d2-3b3a-4a7b-89ef-abcdef123456`) and creates a JSON credentials file in `~/.cloudflared/`.

### Step 4: Configure the Tunnel
Create a configuration file at `~/.cloudflared/config.yml` (or in `C:\MG-Attendance\cloudflared-config.yml`):
```yaml
tunnel: 8f6417d2-3b3a-4a7b-89ef-abcdef123456
credentials-file: C:\Users\ADMIN\.cloudflared\8f6417d2-3b3a-4a7b-89ef-abcdef123456.json

ingress:
  # Route traffic for your custom subdomain to the local FastAPI server
  - hostname: attendance.yourschool.edu
    service: http://localhost:8000
    originRequest:
      noTLSVerify: true
  - service: http_status:404
```

### Step 5: Route the DNS Record
Route your desired subdomain to the tunnel:
```bash
cloudflared tunnel route dns mg-attendance attendance.yourschool.edu
```
Cloudflare automatically creates a CNAME record in your Cloudflare DNS dashboard pointing `attendance.yourschool.edu` directly to your secure tunnel.

### Step 6: Install Tunnel as a Windows Background Service
To make the tunnel run 24/7 as an autonomous Windows Service:
```bash
cloudflared --config C:\Users\ADMIN\.cloudflared\config.yml service install
net start cloudflared
```
Your Kiosk server is now accessible worldwide over high-speed HTTPS with SSL certificates managed automatically by Cloudflare!

---

## 6. Headless Linux / VPS Production Server Setup

If running the backend on a remote dedicated server or Ubuntu 22.04 LTS VPS:

### Step 1: Install System Packages
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.10 python3.10-venv python3-pip libgl1-mesa-glx libglib2.0-0 nginx git
```

### Step 2: Clone & Install
```bash
cd /opt
sudo git clone https://github.com/YourOrg/Attendance-AI-face.git mg-attendance
cd mg-attendance/backend
python3.10 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 3: Configure Systemd Service
Create `/etc/systemd/system/mg-attendance.service`:
```ini
[Unit]
Description=MG Attendance Face Recognition Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/mg-attendance/backend
Environment="PATH=/opt/mg-attendance/backend/.venv/bin:/usr/local/bin:/usr/bin"
ExecStart=/opt/mg-attendance/backend/.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mg-attendance
sudo systemctl status mg-attendance
```

### Step 4: Nginx Reverse Proxy with WebSocket Support
Create `/etc/nginx/sites-available/mg-attendance`:
```nginx
server {
    listen 80;
    server_name attendance.yourschool.edu;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;

        # WebSocket support for live face tracking
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts for video streams
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```
Enable the site and obtain a free Let's Encrypt SSL certificate:
```bash
sudo ln -s /etc/nginx/sites-available/mg-attendance /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d attendance.yourschool.edu
```

---

## 7. Email Notifications & SMTP Configuration

When a student scans their face at the kiosk, the system automatically logs attendance and can dispatch an immediate email alert (e.g. *"Your child Juan Dela Cruz checked in at 7:45 AM"*).

### Option A: Via the Admin Dashboard
1. Log in to the Admin Dashboard (`/`).
2. Go to **Settings** &rarr; **Email / SMTP Configuration**.
3. Fill in your SMTP details and click **Save Settings**.

### Option B: Via `backend/data/settings.json`
Edit or create `backend/data/settings.json`:
```json
{
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_user": "your-school-notifications@gmail.com",
  "smtp_pass": "xxxx xxxx xxxx xxxx",
  "smtp_from": "MG Attendance <your-school-notifications@gmail.com>"
}
```
> [!TIP]
> For **Gmail**, generate an **App Password** (Google Account &rarr; Security &rarr; 2-Step Verification &rarr; App Passwords). Standard account passwords will be blocked by Google.

---

## 8. Mobile App Setup (Student & Guardian Portal)

The mobile app in `mobile/` allows students and parents to view their check-in logs, generate QR passes, and check DTR records.

### Development Mode (Testing on Phone via Expo Go)
```bash
cd mobile
npm install
npx expo start
```
1. Install **Expo Go** from the Google Play Store or Apple App Store.
2. Scan the QR code displayed in the terminal with the Expo Go app.

### Connecting the App to your Server
In the mobile app settings or configuration file (`mobile/src/api/config.ts`), set the base API URL:
```typescript
export const API_BASE_URL = "https://attendance.yourschool.edu";
```

### Production Build (Standalone Android APK)
To build a standalone installable APK without needing Expo Go:
```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```
Download the resulting `.apk` and install it on student/guardian devices.

---

## 9. Database Backup & Maintenance

All persistent system data is stored in the `backend/data/` directory:

| Path | Description |
| :--- | :--- |
| `backend/data/attendance.db` | Primary SQLite database containing students, classes, attendance records, and admin accounts. |
| `backend/data/registered_faces/` | Cropped reference facial images and normalized 512-D face embeddings. |
| `backend/data/settings.json` | Master administrative settings, password hashes, and SMTP credentials. |
| `backend/data/spoof_logs/` | Audit logs of detected photo/screen spoofing attempts with captured frames. |

### Automated Backup Script (Windows)
Create a scheduled task running the following batch command daily:
```bat
@echo off
set "BACKUP_DIR=D:\MG_Backups\%date:~10,4%-%date:~4,2%-%date:~7,2%"
mkdir "%BACKUP_DIR%"
xcopy /E /I /Y "backend\data" "%BACKUP_DIR%\data"
echo Backup completed to %BACKUP_DIR%
```

---

## 10. Troubleshooting & Frequently Asked Questions

### 1. Camera screen is black or "Camera Not Found"
- Ensure no other application (like Zoom, Teams, or the Windows Camera app) is using the webcam.
- In Chrome or Edge, click the lock/tune icon next to the URL and ensure **Camera** is set to **Allow**.
- If multiple cameras are attached, select the correct camera index from the Admin Dashboard or in `backend/server.py`.

### 2. "Escape key doesn't exit fullscreen"
- Chromium `--kiosk` is a locked security mode.
- In this release, the kiosk script launches with `--start-fullscreen`. Press **<kbd>F11</kbd>** at any time to toggle fullscreen on or off, or click the **Admin Portal** button at the top-right header of the kiosk display.

### 3. Port 8000 is already in use
- Run `stop_kiosk.bat` to terminate any previous orphaned backend instances.
- Alternatively, check which process is holding port 8000:
  ```cmd
  netstat -ano | findstr :8000
  taskkill /F /PID <PID_NUMBER>
  ```

### 4. Facial recognition is slow on older hardware
- In `backend/server.py`, lower the processing frame resolution (e.g. resize incoming stream to 640x480).
- Ensure CPU power plan in Windows Settings is set to **High Performance**.
- An external GPU is optional; the lightweight MobileNet/InsightFace pipeline runs at 25–30 FPS on standard modern Intel Core i5 / Ryzen 5 CPUs.

### 5. Cloudflare Tunnel URL changed
- Free `trycloudflare.com` tunnels generate a new random URL upon each startup.
- Follow [Section 5](#5-production-cloud-deployment-custom-domain--named-cloudflare-tunnel) to set up a permanent, free Cloudflare Named Tunnel with your own domain name.
