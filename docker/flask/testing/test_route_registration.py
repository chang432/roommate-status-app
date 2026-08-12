"""Application-factory route registration regression coverage."""

from app import create_app

EXPECTED_ROUTES = frozenset(
    line for line in """GET /api/health
POST /api/login
POST /api/accounts
GET /api/accounts/<user_id>
PATCH /api/accounts/<user_id>
PUT /api/accounts/<user_id>/password
DELETE /api/accounts/<user_id>
POST /api/groups/join
POST /api/groups
GET /api/groups
GET /api/groups/current
PATCH /api/groups/current
PUT /api/groups/modules
PUT /api/groups/theme
DELETE /api/groups/members/<user_id>
PUT /api/groups/members/<user_id>/role
GET /api/roommates
PUT /api/roommates/<roommate_id>/status
POST /api/roommates/notify
POST /api/roommates/<roommate_id>/poke
GET /api/push/public-key
POST /api/push/subscribe
GET /api/book-club
POST /api/book-club/meetings
GET /api/book-club/meetings
GET /api/book-club/meetings/<meeting_id>
PUT /api/book-club/meetings/<meeting_id>/response
POST /api/book-club/meetings/<meeting_id>/complete
POST /api/book-club/books/<book_id>/complete
POST /api/book-club/meetings/<meeting_id>/notify
GET /api/book-club/books
POST /api/book-club/books
PATCH /api/book-club/books/<book_id>
PUT /api/book-club/books/<book_id>/review
GET /api/forums
POST /api/forums
POST /api/forums/<forum_id>/comments
DELETE /api/forums/<forum_id>/comments/<comment_id>/likes
PUT /api/forums/<forum_id>/comments/<comment_id>/likes
POST /api/forums/<forum_id>/archive
POST /api/forums/<forum_id>/restore
DELETE /api/forums/<forum_id>
GET /api/jam
POST /api/jam
DELETE /api/jam
GET /api/feed
PATCH /api/modules/<module_type>/<item_id>
POST /api/counters
GET /api/counters/<counter_id>
POST /api/counters/<counter_id>/entries
PATCH /api/counters/<counter_id>/entries/<entry_id>
DELETE /api/counters/<counter_id>/entries/<entry_id>
POST /api/counters/<counter_id>/archive
POST /api/counters/<counter_id>/restore
DELETE /api/counters/<counter_id>
GET /api/activities
POST /api/activities
POST /api/activities/<activity_id>/start
POST /api/activities/<activity_id>/end
POST /api/activities/<activity_id>/archive
POST /api/activities/<activity_id>/restore
DELETE /api/activities/<activity_id>
POST /api/activities/<activity_id>/join
POST /api/activities/<activity_id>/leave
POST /api/activities/<activity_id>/comments
DELETE /api/activities/<activity_id>/comments/<comment_id>/likes
PUT /api/activities/<activity_id>/comments/<comment_id>/likes
POST /api/activities/<activity_id>/notify
POST /api/requests
POST /api/requests/<request_id>/responses
POST /api/requests/<request_id>/archive
POST /api/requests/<request_id>/restore
DELETE /api/requests/<request_id>
POST /api/requests/<request_id>/comments
DELETE /api/requests/<request_id>/comments/<comment_id>/likes
PUT /api/requests/<request_id>/comments/<comment_id>/likes
POST /api/checklists
POST /api/checklists/<checklist_id>/notify
POST /api/checklists/<checklist_id>/items
POST /api/checklists/<checklist_id>/items/<item_id>/toggle
PATCH /api/checklists/<checklist_id>/items/<item_id>
DELETE /api/checklists/<checklist_id>/items/<item_id>
POST /api/checklists/<checklist_id>/archive
POST /api/checklists/<checklist_id>/restore
DELETE /api/checklists/<checklist_id>
POST /api/polls
POST /api/polls/<poll_id>/options
PATCH /api/polls/<poll_id>/options/<option_id>
DELETE /api/polls/<poll_id>/options/<option_id>/votes
PUT /api/polls/<poll_id>/options/<option_id>/votes
POST /api/polls/<poll_id>/comments
DELETE /api/polls/<poll_id>/comments/<comment_id>/likes
PUT /api/polls/<poll_id>/comments/<comment_id>/likes
POST /api/polls/<poll_id>/archive
POST /api/polls/<poll_id>/restore
DELETE /api/polls/<poll_id>
GET /api/shows
POST /api/shows
POST /api/shows/<show_id>/join
POST /api/shows/<show_id>/leave
PATCH /api/shows/<show_id>/watchers/<member_id>/<field>
PUT /api/shows/<show_id>/watchers/<member_id>/<field>
POST /api/shows/<show_id>/archive
POST /api/shows/<show_id>/restore
DELETE /api/shows/<show_id>
POST /api/shows/<show_id>/watchparty/start
POST /api/shows/<show_id>/watchparty/end""".splitlines() if line
)


def test_application_factory_registers_the_complete_public_api():
    app = create_app()
    actual = {
        f"{method} {rule.rule}"
        for rule in app.url_map.iter_rules()
        if rule.rule.startswith("/api/")
        for method in rule.methods - {"HEAD", "OPTIONS"}
    }
    assert actual == EXPECTED_ROUTES

