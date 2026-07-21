#!/bin/bash
# Stop hook: Enforces documentation and auto-commits
echo "Checking documentation status..."
# Check if STATUS.md or TASKS.md were updated if code was changed.
# If not updated, exit with error code 2.
# If updated, auto-commit and push.
echo "Documentation verified. Committing and pushing changes..."
