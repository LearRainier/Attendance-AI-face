"""
make_dev_cert.py — generate a self-signed certificate so a phone can use its
own camera with this dashboard.

Why this exists: browsers only expose ``getUserMedia`` in a *secure context*.
``localhost`` counts as secure, but ``http://192.168.x.x:8000`` does not — so a
phone opening the dashboard over the LAN has no camera API at all, and the
"This device" video source can't be used (the dashboard detects this and says
so instead of failing mysteriously). Serving the same app over HTTPS fixes it.

The certificate is self-signed, so each phone shows a one-time "not private"
warning that has to be accepted; after that the origin is secure and the
camera works. This is for a LAN/development setup, not for exposing the
dashboard to the internet.

Usage:
    pip install cryptography          # only needed for this script
    python scripts/make_dev_cert.py
    python -m uvicorn server:app --host 0.0.0.0 --port 8000 \
        --ssl-keyfile certs/dev-key.pem --ssl-certfile certs/dev-cert.pem
"""

import datetime
import ipaddress
import os
import socket
import sys

try:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
except ImportError:
    sys.exit(
        "This script needs the 'cryptography' package:\n"
        "    pip install cryptography\n"
        "It isn't in requirements.txt because it's only used to create this "
        "optional development certificate, not by the server itself."
    )

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERT_DIR = os.path.join(BASE_DIR, "certs")
CERT_PATH = os.path.join(CERT_DIR, "dev-cert.pem")
KEY_PATH = os.path.join(CERT_DIR, "dev-key.pem")
VALID_DAYS = 365


def local_ipv4_addresses():
    """Every non-loopback IPv4 address of this machine — the certificate has to
    name the exact address the phone types into its browser, or the phone will
    reject it outright rather than merely warning."""
    addresses = set()
    hostname = socket.gethostname()
    for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
        addresses.add(info[4][0])
    # getaddrinfo can miss the address actually used to reach the LAN, so ask
    # the routing table which interface would be used for an outbound packet.
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        addresses.add(probe.getsockname()[0])
    except OSError:
        pass
    finally:
        probe.close()
    return sorted(a for a in addresses if not a.startswith("127."))


def main():
    if os.path.exists(CERT_PATH) and "--force" not in sys.argv:
        sys.exit(f"{CERT_PATH} already exists. Pass --force to regenerate it.")

    addresses = local_ipv4_addresses()
    hostname = socket.gethostname()
    print(f"Hostname: {hostname}")
    print(f"LAN addresses: {', '.join(addresses) if addresses else '(none found)'}")

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, hostname),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "AI Face ID (development)"),
    ])

    alt_names = [x509.DNSName(hostname), x509.DNSName("localhost")]
    alt_names += [x509.IPAddress(ipaddress.ip_address(a)) for a in addresses]
    alt_names.append(x509.IPAddress(ipaddress.ip_address("127.0.0.1")))

    now = datetime.datetime.now(datetime.timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=VALID_DAYS))
        .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    os.makedirs(CERT_DIR, exist_ok=True)
    with open(KEY_PATH, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))
    with open(CERT_PATH, "wb") as f:
        f.write(certificate.public_bytes(serialization.Encoding.PEM))

    print(f"\nWrote {KEY_PATH}\n      {CERT_PATH}  (valid {VALID_DAYS} days)")
    print("\nStart the backend over HTTPS with:")
    print("  python -m uvicorn server:app --host 0.0.0.0 --port 8000 \\")
    print("      --ssl-keyfile certs/dev-key.pem --ssl-certfile certs/dev-cert.pem")
    if addresses:
        print(f"\nThen open https://{addresses[0]}:8000 on the phone and accept the "
              "one-time certificate warning.")


if __name__ == "__main__":
    main()
