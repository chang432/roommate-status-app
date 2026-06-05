"""Generate a VAPID key pair for Web Push.

Run once, then set the printed values as secrets/env vars (see push.py):

    python gen_vapid.py

Outputs:
    VAPID_PUBLIC_KEY   base64url of the uncompressed EC P-256 public point.
                       The browser uses this as `applicationServerKey`.
    VAPID_PRIVATE_KEY  base64url of the raw 32-byte private scalar. Server-only;
                       push.py turns it back into a PEM to sign pushes.

Keep the private key secret. Regenerating invalidates all existing
subscriptions (clients must re-subscribe).
"""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def main() -> None:
    key = ec.generate_private_key(ec.SECP256R1())

    # Raw 32-byte private scalar.
    private_raw = key.private_numbers().private_value.to_bytes(32, "big")

    # Uncompressed public point (0x04 || X || Y), 65 bytes — the form browsers
    # and the Web Push spec expect for the application server key.
    public_raw = key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )

    print(f"VAPID_PUBLIC_KEY={_b64url(public_raw)}")
    print(f"VAPID_PRIVATE_KEY={_b64url(private_raw)}")


if __name__ == "__main__":
    main()
