"""
emailer.py — Student credentials generation and email dispatch.

Generates initial mobile login credentials for newly registered students and
dispatches them to their domain email.

If SMTP is configured in data/settings.json or environment variables, sends via
smtplib. Otherwise, logs the email to console and saves the message to
data/outbox/<student_number>.json so development and testing proceed smoothly.
"""

import json
import logging
import os
import random
import smtplib
import string
from datetime import datetime
from email.message import EmailMessage

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTBOX_DIR = os.path.join(BASE_DIR, "data", "outbox")


def generate_temporary_password(length=8):
    """Generate a clean temporary password like 'MG-7K9P2X'."""
    alphabet = string.ascii_uppercase + string.digits
    suffix = "".join(random.choices(alphabet, k=length - 3))
    return f"MG-{suffix}"


def dispatch_student_credentials(student_name, student_number, email, temporary_password, settings=None):
    """
    Dispatch student account credentials to their domain email.

    Parameters
    ----------
    student_name : str
        Student full name.
    student_number : str
        Validated format (YY-NNNNN).
    email : str
        Domain email address.
    temporary_password : str
        Generated initial password.
    settings : dict, optional
        System settings containing SMTP configuration if available.

    Returns
    -------
    dict
        {"status": "delivered"|"queued_outbox", "email": email, "timestamp": str}
    """
    settings = settings or {}
    smtp_host = settings.get("smtp_host") or os.environ.get("SMTP_HOST")
    smtp_port = int(settings.get("smtp_port") or os.environ.get("SMTP_PORT", 587))
    smtp_user = settings.get("smtp_user") or os.environ.get("SMTP_USER")
    smtp_pass = settings.get("smtp_pass") or os.environ.get("SMTP_PASS")
    smtp_from = settings.get("smtp_from") or os.environ.get("SMTP_FROM") or "attendance@mg-system.local"

    subject = f"Your MG Attendance Mobile App Credentials ({student_number})"
    body = f"""Hello {student_name},

Your face recognition attendance profile has been registered in the MG Attendance System.
Your student mobile app account has been created with the following credentials:

---------------------------------------------
Student ID / Username : {student_number}
Domain Email          : {email}
Temporary Password    : {temporary_password}
---------------------------------------------

You can use these credentials to log in to the MG Attendance mobile application.
Please change your temporary password upon first login.

Thank you,
MG Attendance System Administration
"""

    now_iso = datetime.now().isoformat()

    # Try SMTP if host is configured
    if smtp_host and smtp_user and smtp_pass:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = smtp_from
            msg["To"] = email
            msg.set_content(body)

            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
                server.starttls()
                server.login(smtp_user, smtp_pass)
                server.send_message(msg)

            logger.info("Successfully sent credentials email to %s via SMTP (%s)", email, smtp_host)
            return {"status": "delivered", "mode": "smtp", "email": email, "timestamp": now_iso}
        except Exception as e:
            logger.warning("SMTP dispatch failed for %s: %s. Falling back to outbox.", email, e)

    # Fallback: Save to data/outbox/ for inspection and logging
    os.makedirs(OUTBOX_DIR, exist_ok=True)
    outbox_file = os.path.join(OUTBOX_DIR, f"{student_number}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    record = {
        "student_name": student_name,
        "student_number": student_number,
        "email": email,
        "temporary_password": temporary_password,
        "subject": subject,
        "body": body,
        "timestamp": now_iso,
        "status": "queued_outbox",
    }

    try:
        with open(outbox_file, "w", encoding="utf-8") as f:
            json.dump(record, f, indent=2)
        logger.info("[OUTBOX] Credentials saved for %s <%s> to %s", student_name, email, outbox_file)
    except Exception as e:
        logger.error("Failed to save outbox file: %s", e)

    return {"status": "queued_outbox", "mode": "outbox", "email": email, "timestamp": now_iso}
