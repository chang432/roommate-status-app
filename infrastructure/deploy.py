#!/usr/bin/env python3
"""Deploy the DynamoDB CloudFormation stack.

Creates the stack if it doesn't exist, otherwise updates it, then waits for the
operation to finish and prints the stack outputs.

Assumes AWS credentials are already configured locally (via environment
variables, a shared credentials file, or an instance/SSO profile) — the same
resolution boto3 uses by default.

Examples:
    python deploy.py
    python deploy.py --stack-name roomie-prod --table-name RoommateStatus \\
        --environment prod --region us-east-1
"""

from __future__ import annotations

import argparse
import os
import sys

import boto3
from botocore.exceptions import ClientError, WaiterError

# Default template lives next to this script.
DEFAULT_TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dynamodb-table.yaml")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Deploy the DynamoDB CloudFormation stack.")
    parser.add_argument("--stack-name", default="roomie-dynamodb", help="CloudFormation stack name.")
    parser.add_argument("--template", default=DEFAULT_TEMPLATE, help="Path to the CloudFormation template.")
    parser.add_argument("--table-name", default="RoommateStatus", help="DynamoDB table name (TableName parameter).")
    parser.add_argument(
        "--environment",
        default="dev",
        choices=["dev", "staging", "prod"],
        help="Environment tag (Environment parameter).",
    )
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


def deploy(cfn, args, template_body: str) -> bool:
    """Create or update the stack. Returns True if a change was submitted."""
    params = [
        {"ParameterKey": "TableName", "ParameterValue": args.table_name},
        {"ParameterKey": "Environment", "ParameterValue": args.environment},
    ]
    common = dict(StackName=args.stack_name, TemplateBody=template_body, Parameters=params)

    if stack_exists(cfn, args.stack_name):
        print(f"Updating existing stack '{args.stack_name}'…")
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
        print(f"Creating new stack '{args.stack_name}'…")
        cfn.create_stack(**common)
        waiter_name = "stack_create_complete"

    print("Waiting for CloudFormation to finish…")
    cfn.get_waiter(waiter_name).wait(StackName=args.stack_name)
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

    try:
        with open(args.template, "r", encoding="utf-8") as fh:
            template_body = fh.read()
    except OSError as err:
        print(f"Could not read template: {err}", file=sys.stderr)
        return 1

    # boto3 resolves region/credentials from the standard AWS config chain.
    cfn = boto3.client("cloudformation", region_name=args.region)

    try:
        deploy(cfn, args, template_body)
        print(f"\nStack '{args.stack_name}' is ready.")
        print_outputs(cfn, args.stack_name)
    except (ClientError, WaiterError) as err:
        print(f"\nDeployment failed: {err}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
