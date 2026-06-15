---
description: Open the HQ dashboard in your browser, pinned to this session.
---

The user wants to open HQ for the session they are in right now. Do exactly this, and nothing else:

1. Run this bash command, verbatim:
   `hq 2>/dev/null || bash "$HOME/code/hq/bin/hq"`
2. Reply with only the command's final lines (the "HQ is now open …" message). Nothing more.

Do not read files, explore the repo, or run any other command.
