#!/bin/bash
set -e

TEAM=$1

if [ "$TEAM" != "backend" ] && [ "$TEAM" != "frontend" ]; then
    echo "Usage: ./agents/run_loop.sh [backend|frontend]"
    exit 1
fi

echo "=================================================="
echo "🚀 Launching Agent Loop for Team: $TEAM"
echo "=================================================="

TEAM_DIR="agents/${TEAM}-team"

if [ ! -d "$TEAM_DIR" ]; then
    echo "Error: Team directory $TEAM_DIR does not exist."
    exit 1
fi

echo "📋 Active Prompt: $TEAM_DIR/PROMPT.md"
echo "📝 Task Queue:   $TEAM_DIR/TASKS.md"

if [ "$TEAM" = "frontend" ] && [ -f "agents/backend-team/HANDOFF.md" ]; then
    echo "🔗 Reading Backend Handoff Contract: agents/backend-team/HANDOFF.md"
fi

echo ""
echo "Team [$TEAM] loop initialized. Focus on current uncompleted task in $TEAM_DIR/TASKS.md."
