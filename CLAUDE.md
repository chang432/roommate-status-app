# Initialization

Before processing any response, read every Markdown (`.md`) file in the root
of the repository into context. At minimum this includes:

- `AGENTS.md`

Do this once at the start of a session so the contents are available as
context for the rest of the conversation. If new `.md` files are added to the
repo root later, read those as well.
