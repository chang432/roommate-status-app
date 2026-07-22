"""Shared DynamoDB and Flask-client fixtures for API tests."""

from testing.support import *  # noqa: F403

@pytest.fixture(scope="session", autouse=True)
def _dynamodb():
    """Stand up mocked DynamoDB tables for the whole test session.

    Mirrors the infrastructure templates (infrastructure/dynamodb-table-{dev,
    main}.yaml), which provision the roommate, push-subscriptions, and
    activities tables — the modules don't create them. Kept open for the session
    so the modules' cached table resources stay valid.
    """
    with mock_aws():
        ddb = boto3.resource("dynamodb")
        for table_name in (db.TABLE_NAME, jam.TABLE_NAME):
            ddb.create_table(
                TableName=table_name,
                KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
                AttributeDefinitions=[{"AttributeName": "id", "AttributeType": "S"}],
                BillingMode="PAY_PER_REQUEST",
            )
        # The feed tables partition on groupId and sort by id, so a household's
        # rows are one Query (see docker/flask/group_tables.py).
        for table_name in (
            activities.TABLE_NAME,
            book_club.TABLE_NAME,
            comment_likes.TABLE_NAME,
            household_requests.TABLE_NAME,
            household_shows.TABLE_NAME,
            household_checklists.TABLE_NAME,
        ):
            definitions = [
                {"AttributeName": "groupId", "AttributeType": "S"},
                {"AttributeName": "id", "AttributeType": "S"},
            ]
            indexes = []
            if table_name == book_club.TABLE_NAME:
                definitions.append({"AttributeName": "bookId", "AttributeType": "S"})
                indexes = [{
                    "IndexName": book_club.BOOK_ID_INDEX,
                    "KeySchema": [
                        {"AttributeName": "bookId", "KeyType": "HASH"},
                        {"AttributeName": "id", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }]
            ddb.create_table(
                TableName=table_name,
                KeySchema=[
                    {"AttributeName": "groupId", "KeyType": "HASH"},
                    {"AttributeName": "id", "KeyType": "RANGE"},
                ],
                AttributeDefinitions=definitions,
                **({"GlobalSecondaryIndexes": indexes} if indexes else {}),
                BillingMode="PAY_PER_REQUEST",
            )
        # Subscriptions stay keyed by endpoint hash (one row per device) and
        # find their owner's devices through UserIdIndex.
        ddb.create_table(
            TableName=push.TABLE_NAME,
            KeySchema=[{"AttributeName": "id", "KeyType": "HASH"}],
            AttributeDefinitions=[
                {"AttributeName": "id", "AttributeType": "S"},
                {"AttributeName": "userId", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": push.USER_ID_INDEX,
                    "KeySchema": [{"AttributeName": "userId", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        ddb.create_table(
            TableName=groups.GROUPS_TABLE,
            KeySchema=[{"AttributeName": "groupId", "KeyType": "HASH"}],
            AttributeDefinitions=[
                {"AttributeName": "groupId", "AttributeType": "S"},
                {"AttributeName": "joinCode", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": groups.JOIN_CODE_INDEX,
                    "KeySchema": [{"AttributeName": "joinCode", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        ddb.create_table(
            TableName=db.MEMBERSHIPS_TABLE,
            KeySchema=[
                {"AttributeName": "groupId", "KeyType": "HASH"},
                {"AttributeName": "userId", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "groupId", "AttributeType": "S"},
                {"AttributeName": "userId", "AttributeType": "S"},
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": db.MEMBERSHIP_USER_INDEX,
                    "KeySchema": [{"AttributeName": "userId", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield


@pytest.fixture()
def client():
    db.reset()  # Isolate each test from prior status mutations.
    # Clear mutable tables so each test starts with no activities/subscriptions.
    for table in (
        activities._get_table(),
        book_club._get_table(),
        comment_likes._get_table(),
        household_requests._get_table(),
        household_shows._get_table(),
        household_checklists._get_table(),
    ):
        for item in table.scan().get("Items", []):
            table.delete_item(Key={"groupId": item["groupId"], "id": item["id"]})
    for table in (push._get_table(), jam._get_table()):
        for item in table.scan().get("Items", []):
            table.delete_item(Key={"id": item["id"]})
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()
