#!/usr/bin/env python3
"""Deploy a DynamoDB CloudFormation stack for the dev or main environment.

There are two independent deployments, each with its own template and its own
DynamoDB table (see dynamodb-table-dev.yaml / dynamodb-table-main.yaml):

    --deployment dev   -> stack "roomie-dynamodb-dev",  table "RoommateStatus-dev"
    --deployment main  -> stack "roomie-dynamodb-main", table "RoommateStatus-main"

Creates the stack if it doesn't exist, otherwise updates it, then waits for the
operation to finish and prints the stack outputs.

Assumes AWS credentials are already configured locally (via environment
variables, a shared credentials file, or an instance/SSO profile) — the same
resolution boto3 uses by default.

Examples:
    python deploy.py                       # defaults to the dev deployment
    python deploy.py --deployment main --region us-east-1
"""

from __future__ import annotations

import argparse
import os
import sys

import boto3
from botocore.exceptions import ClientError, WaiterError

# Templates live next to this script.
_HERE = os.path.dirname(os.path.abspath(__file__))

# Each deployment is fully described by its own template + stack name. The table
# name itself is baked into the template, so there is nothing per-environment to
# pass as a CloudFormation parameter — picking the deployment picks everything.
DEPLOYMENTS = {
    "dev": {
        "template": os.path.join(_HERE, "dynamodb-table-dev.yaml"),
        "stack_name": "roomie-dynamodb-dev",
    },
    "main": {
        "template": os.path.join(_HERE, "dynamodb-table-main.yaml"),
        "stack_name": "roomie-dynamodb-main",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy a DynamoDB CloudFormation stack.")
    parser.add_argument(
        "--deployment",
        default="dev",
        choices=sorted(DEPLOYMENTS),
        help="Which deployment to provision: 'dev' (default) or 'main'. Selects the template and stack name.",
    )
    # Both default to None so the deployment's built-in values are used unless
    # explicitly overridden.
    parser.add_argument("--stack-name", default=None, help="Override the CloudFormation stack name.")
    parser.add_argument("--template", default=None, help="Override the path to the CloudFormation template.")
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"),
        help="AWS region (defaults to the configured AWS_REGION/AWS_DEFAULT_REGION).",
    )
    return parser.parse_args()


def stack_exists(cfn, stack_name: str) -> bool:
    """Return True if the stack exists (and isn't in the REVIEW/rollback-only state)."""
    try:
        resp = cfn.describe_stacks(StackName=stack_name)
    except ClientError as err:
        # CloudFormation reports a missing stack as a validation error.
        if "does not exist" in str(err):
            return False
        raise
    status = resp["Stacks"][0]["StackStatus"]
    # A stack left in REVIEW_IN_PROGRESS (failed initial change set) can't be
    # updated and must be created fresh.
    return status != "REVIEW_IN_PROGRESS"


def deploy(cfn, stack_name: str, template_body: str) -> bool:
    """Create or update the stack. Returns True if a change was submitted."""
    # The table name and tags are fixed in the template, so no parameters are
    # passed here.
    common = dict(StackName=stack_name, TemplateBody=template_body)

    if stack_exists(cfn, stack_name):
        print(f"Updating existing stack '{stack_name}'…")
        try:
            cfn.update_stack(**common)
        except ClientError as err:
            # An update with no diffs isn't an error for our purposes.
            if "No updates are to be performed" in str(err):
                print("No changes to apply — stack is already up to date.")
                return False
            raise
        waiter_name = "stack_update_complete"
    else:
        print(f"Creating new stack '{stack_name}'…")
        cfn.create_stack(**common)
        waiter_name = "stack_create_complete"

    print("Waiting for CloudFormation to finish…")
    cfn.get_waiter(waiter_name).wait(StackName=stack_name)
    return True


def print_outputs(cfn, stack_name: str) -> None:
    resp = cfn.describe_stacks(StackName=stack_name)
    outputs = resp["Stacks"][0].get("Outputs", [])
    if not outputs:
        return
    print("\nStack outputs:")
    for out in outputs:
        print(f"  {out['OutputKey']}: {out['OutputValue']}")


def main() -> int:
    args = parse_args()

    # Resolve everything from the chosen deployment, allowing explicit overrides.
    cfg = DEPLOYMENTS[args.deployment]
    stack_name = args.stack_name or cfg["stack_name"]
    template = args.template or cfg["template"]

    try:
        with open(template, "r", encoding="utf-8") as fh:
            template_body = fh.read()
    except OSError as err:
        print(f"Could not read template: {err}", file=sys.stderr)
        return 1

    # boto3 resolves region/credentials from the standard AWS config chain.
    cfn = boto3.client("cloudformation", region_name=args.region)

    try:
        deploy(cfn, stack_name, template_body)
        print(f"\nStack '{stack_name}' is ready.")
        print_outputs(cfn, stack_name)
    except (ClientError, WaiterError) as err:
        print(f"\nDeployment failed: {err}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
