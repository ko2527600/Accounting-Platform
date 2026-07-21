#!/bin/bash
# SessionStart hook: Injects memory and catches up log
echo "Session started. Loading STATUS.md and TASKS.md..."
# In a real environment, this would use 'cat' to output to the agent's context.
# For now, we'll just log the action.
cat STATUS.md
cat TASKS.md
echo "Context loaded."
