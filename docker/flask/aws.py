"""Shared boto3 DynamoDB resource factory.

Extracted from db.py so anything that only needs a DynamoDB handle — the Flask
app modules *and* the standalone migration runner
(infrastructure/migrations/runner.py) — can build one the same way without
pulling in the app's heavier dependencies (Flask/werkzeug/pywebpush). This
module depends on boto3 only.
"""

from __future__ import annotations

import os
import re

import boto3

# Region the DynamoDB table lives in. Falls back to us-east-1 when the standard
# AWS region vars are unset/blank so a missing/empty AWS_REGION can't leave
# boto3 with an empty signing region (which fails as InvalidSignatureException:
# "Credential should be scoped to a valid region").
DEFAULT_REGION = "us-east-1"

# AWS region identifiers look like "us-east-1" / "eu-central-1". Anything that
# doesn't match this shape (blank, accidental quotes, internal whitespace, a
# typo) is treated as unset so we fall back to DEFAULT_REGION rather than sign
# requests with a bad region — which AWS rejects as InvalidSignatureException:
# "Credential should be scoped to a valid region".
_REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-\d+$")


def _region() -> str:
    """Resolve the AWS region, defaulting to us-east-1 when none is valid."""
    region = (os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "").strip()
    return region if _REGION_RE.match(region) else DEFAULT_REGION


def _endpoint() -> str | None:
    """Optional DynamoDB endpoint override for local development.

    When DYNAMODB_ENDPOINT is set (e.g. a DynamoDB Local container), boto3 talks
    to it instead of real AWS — so local runs need no AWS account. Unset in
    production, where None means "use the real DynamoDB endpoint" and behavior
    is unchanged.
    """
    return os.environ.get("DYNAMODB_ENDPOINT") or None


def resource():
    """Build a DynamoDB resource honoring the region and local-endpoint override.

    Shared so every caller signs requests the same way and picks up
    DYNAMODB_ENDPOINT together. endpoint_url=None is the boto3 default (real
    AWS), so production is unaffected.
    """
    return boto3.resource("dynamodb", region_name=_region(), endpoint_url=_endpoint())
