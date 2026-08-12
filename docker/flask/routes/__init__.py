"""Blueprint registry for the Roomie Status API."""

from routes.activities import bp as activities_bp
from routes.book_club import bp as book_club_bp
from routes.checklists import bp as checklists_bp
from routes.counters import bp as counters_bp
from routes.feed import bp as feed_bp
from routes.forums import bp as forums_bp
from routes.household import bp as household_bp
from routes.polls import bp as polls_bp
from routes.requests import bp as requests_bp
from routes.shows import bp as shows_bp

BLUEPRINTS = (
    household_bp,
    book_club_bp,
    forums_bp,
    feed_bp,
    counters_bp,
    activities_bp,
    requests_bp,
    checklists_bp,
    polls_bp,
    shows_bp,
)

