# MG Attendance — AI Facial Recognition & Kiosk System

An enterprise-grade, contactless facial recognition attendance kiosk and administrative management platform. Built with **FastAPI**, **DeepFace / InsightFace**, **React 19**, **Tailwind CSS**, and **Cloudflare Zero Trust Tunnels**.

---

## Features

- **Real-Time Edge AI**: Sub-second face detection, tracking, and 512-D embedding recognition using OpenCV & InsightFace.
- **Anti-Spoofing & Liveness Verification**: Defends against printed photos, mobile screen replays, and video spoofs.
- **Turnkey Kiosk Station**: Autonomous 1-click startup scripts (`start_kiosk.bat`) with auto-reconnect and fullscreen toggle (<kbd>F11</kbd>).
- **Admin Management Portal**: Real-time Daily Time Records (DTR), user enrollment, audit logs, and attendance analytics.
- **Cloudflare Zero Trust Integration**: Instant, secure remote access worldwide without port forwarding or public IP requirements.
- **Automated Email Notifications**: Dispatches instant check-in/check-out email notifications to parents and guardians.
- **Student Mobile App**: Cross-platform Expo/React Native companion app for digital ID passes and attendance records.

---

## Quick Start

### 1. Requirements
- **Windows 10/11** or **Ubuntu 22.04 LTS**
- **Python 3.10 or 3.11** (with "Add Python to PATH" enabled)
- USB Webcam or built-in camera

### 2. Launch Kiosk (1-Click)
Double-click either launcher script in the project root:
- **`start_kiosk.bat`**: Offline / Local-only Kiosk Station.
- **`start_kiosk_with_tunnel.bat`**: Kiosk Station with live Cloudflare tunnel for remote access.
- **`stop_kiosk.bat`**: Clean 1-click shutdown.

### 3. Default Access URLs & Credentials
- **Kiosk Station**: `http://localhost:8000/kiosk`
- **Admin Dashboard**: `http://localhost:8000/`
- **Default Username**: `admin`
- **Default Password**: `admin123` *(change upon first login)*

---

## Complete Documentation

For detailed guides, refer to the [Complete Setup & Deployment Guide](SETUP_GUIDE.md):

- [Local Development Setup](SETUP_GUIDE.md#3-local-development-setup-for-developers)
- [Edge Kiosk PC Turnkey Setup](SETUP_GUIDE.md#4-edge-kiosk-pc-deployment-single-pc-turnkey-station)
- [Custom Domain & Cloudflare Named Tunnel](SETUP_GUIDE.md#5-production-cloud-deployment-custom-domain--named-cloudflare-tunnel)
- [Headless Linux / VPS Production Server](SETUP_GUIDE.md#6-headless-linux--vps-production-server-setup)
- [SMTP Email Setup](SETUP_GUIDE.md#7-email-notifications--smtp-configuration)
- [Mobile App Setup](SETUP_GUIDE.md#8-mobile-app-setup-student--guardian-portal)
- [Database Backups & Maintenance](SETUP_GUIDE.md#9-database-backup--maintenance)
- [Troubleshooting & FAQ](SETUP_GUIDE.md#10-troubleshooting--frequently-asked-questions)
