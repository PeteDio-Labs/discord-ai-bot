#!/bin/bash
# Test Ollama tool calling with summarizer support
# Simulates: User Prompt → Main Model (tool decision) → Tool (raw JSON) → Summarizer → Main Model → Response
# Usage: ./scripts/test-ollama-tool.sh "your prompt here"
# Environment:
#   OLLAMA_HOST - Ollama server URL (default: http://type-shit:11434 - production server)
#   OLLAMA_MODEL - Main model for tool decisions (default: qwen2.5:7b - optimized for tool calling)
#   SUMMARIZER_MODEL - Small model for data summarization (default: qwen2.5:3b)
#   SUMMARIZER_ENABLED - Enable summarizer step (default: true)
#   OLLAMA_TIMEOUT - Curl max-time in seconds (default: 45)
#   QBITTORRENT_HOST - qBittorrent server (default: http://192.168.50.21:8080)

set -e

OLLAMA_HOST="${OLLAMA_HOST:-http://type-shit:11434}"
MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
SUMMARIZER_MODEL="${SUMMARIZER_MODEL:-qwen2.5:3b}"
SUMMARIZER_ENABLED="${SUMMARIZER_ENABLED:-true}"
OLLAMA_TIMEOUT="${OLLAMA_TIMEOUT:-45}"
QBITTORRENT_HOST="${QBITTORRENT_HOST:-http://192.168.50.21:8080}"
PROMPT="${1:-What torrents are downloading?}"

echo "═══════════════════════════════════════════════════════════"
echo "Testing Multi-Step Tool Flow with Summarizer"
echo "═══════════════════════════════════════════════════════════"
echo "Host: $OLLAMA_HOST"
echo "Main Model: $MODEL"
echo "Summarizer Model: $SUMMARIZER_MODEL"
echo "Summarizer Enabled: $SUMMARIZER_ENABLED"
echo "Ollama Timeout: $OLLAMA_TIMEOUT seconds"
echo "Prompt: $PROMPT"
echo "═══════════════════════════════════════════════════════════"

# Step 1: Main model decides to call qbittorrent tool
echo ""
echo "STEP 1: Main model deciding which tool to call..."
echo "---"

TOOL_DECISION=$(curl -s --connect-timeout 5 --max-time "$OLLAMA_TIMEOUT" "$OLLAMA_HOST/api/chat" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "model": "$MODEL",
  "stream": false,
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant with tools. Use the simplest approach to answer questions. Don't ask for parameters unless required.\n\nTools:\n• qbittorrent: Actions: list (show torrents, optional filter: downloading|seeding|completed|paused|active), details (requires hash), speeds, transfer_info. Use \"list\" for \"show downloads\" questions.\n• calculate: Evaluate math expressions. Examples: \"2+2\", \"sqrt(16)\", \"pow(2,8)\". Supports +,-,*,/,% and functions: sqrt, pow, sin, cos, tan, log, abs, ceil, floor, round, PI, E.\n• get_current_time: Get current time. Optional timezone param (IANA format: \"America/New_York\", \"Europe/London\"). Defaults to UTC."
    },
    {
      "role": "user",
      "content": "$PROMPT"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "qbittorrent",
        "description": "Query qBittorrent for torrent status, download/upload speeds, and transfer information. Returns raw JSON data.",
        "parameters": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "description": "Action to perform",
              "enum": ["list", "details", "speeds", "transfer_info"]
            },
            "filter": {
              "type": "string",
              "description": "Filter torrents (used with list action)",
              "enum": ["all", "downloading", "seeding", "completed", "paused", "active", "inactive", "stalled"]
            },
            "hash": {
              "type": "string",
              "description": "Torrent hash (required for details action)"
            }
          },
          "required": ["action"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "calculate",
        "description": "Perform a mathematical calculation.",
        "parameters": {
          "type": "object",
          "properties": {
            "expression": {
              "type": "string",
              "description": "Mathematical expression to evaluate"
            }
          },
          "required": ["expression"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "get_current_time",
        "description": "Get the current date and time in a specified timezone",
        "parameters": {
          "type": "object",
          "properties": {
            "timezone": {
              "type": "string",
              "description": "IANA timezone name (e.g., America/New_York). Defaults to UTC."
            }
          },
          "required": []
        }
      }
    }
  ]
}
EOF
)

echo "$TOOL_DECISION" | jq .

# Extract tool call details
TOOL_CALLS=$(echo "$TOOL_DECISION" | jq -r '.message.tool_calls // empty')

if [ -z "$TOOL_CALLS" ] || [ "$TOOL_CALLS" = "null" ]; then
  echo ""
  echo "❌ No tool call detected. Model responded directly:"
  echo "$TOOL_DECISION" | jq -r '.message.content'
  exit 0
fi

TOOL_NAME=$(echo "$TOOL_DECISION" | jq -r '.message.tool_calls[0].function.name')
echo ""
echo "✓ Tool selected: $TOOL_NAME"

if [ "$TOOL_NAME" != "qbittorrent" ]; then
  echo "⚠️  Non-qbittorrent tool called. Summarizer only works with qbittorrent."
  echo "Tool args: $(echo "$TOOL_DECISION" | jq -r '.message.tool_calls[0].function.arguments')"
  exit 0
fi

# Step 2: Simulate qbittorrent tool returning raw JSON
echo ""
echo "STEP 2: qbittorrent tool fetching raw JSON data..."
echo "---"

ACTION=$(echo "$TOOL_DECISION" | jq -r '.message.tool_calls[0].function.arguments' | jq -r '.action')
FILTER=$(echo "$TOOL_DECISION" | jq -r '.message.tool_calls[0].function.arguments' | jq -r '.filter // "all"')

echo "Action: $ACTION, Filter: $FILTER"

# Simulate raw JSON response (in real implementation, this comes from QBittorrentClient)
RAW_JSON=$(cat <<'RAWJSON'
{
  "success": true,
  "action": "list",
  "filter": "downloading",
  "count": 3,
  "torrents": [
    {
      "name": "Ubuntu 24.04 LTS Desktop",
      "state": "downloading",
      "progress": 67,
      "dlSpeed": 5242880,
      "upSpeed": 1048576,
      "hash": "abc123"
    },
    {
      "name": "Debian 12 Bookworm ISO",
      "state": "downloading",
      "progress": 23,
      "dlSpeed": 3145728,
      "upSpeed": 524288,
      "hash": "def456"
    },
    {
      "name": "Arch Linux Latest",
      "state": "downloading",
      "progress": 89,
      "dlSpeed": 8388608,
      "upSpeed": 2097152,
      "hash": "ghi789"
    }
  ]
}
RAWJSON
)

echo "$RAW_JSON" | jq .

# Step 3: Summarizer processes raw JSON (if enabled)
if [ "$SUMMARIZER_ENABLED" = "true" ]; then
  echo ""
  echo "STEP 3: Summarizer ($SUMMARIZER_MODEL) processing raw JSON..."
  echo "---"
  
  SUMMARIZER_PROMPT="You are a data summarizer. Convert this qBittorrent JSON data into a concise, user-friendly summary to answer the user's question: \"$PROMPT\"

Raw data:
$RAW_JSON

Provide a brief, natural language summary suitable for a Discord chat response."

  # Use jq to properly escape the prompt for JSON
  SUMMARY=$(jq -n --arg model "$SUMMARIZER_MODEL" --arg prompt "$SUMMARIZER_PROMPT" \
    '{model: $model, prompt: $prompt, stream: false}' | \
    curl -s --connect-timeout 5 --max-time "$OLLAMA_TIMEOUT" "$OLLAMA_HOST/api/generate" \
    -H "Content-Type: application/json" \
    -d @- | jq -r .response)
  
  echo "✓ Summary generated:"
  echo "$SUMMARY"
  
  TOOL_RESULT="$SUMMARY"
else
  echo ""
  echo "STEP 3: Summarizer disabled - using raw JSON directly"
  echo "---"
  TOOL_RESULT="$RAW_JSON"
fi

# Step 4: Send tool result back to main model for final response
echo ""
echo "STEP 4: Main model generating final response with tool result..."
echo "---"

FINAL_RESPONSE=$(curl -s --connect-timeout 5 --max-time "$OLLAMA_TIMEOUT" "$OLLAMA_HOST/api/chat" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "model": "$MODEL",
  "stream": false,
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant with tools."
    },
    {
      "role": "user",
      "content": "$PROMPT"
    },
    $(echo "$TOOL_DECISION" | jq '.message'),
    {
      "role": "tool",
      "content": "$(echo "$TOOL_RESULT" | tr '\n' ' ' | sed 's/"/\\"/g')"
    }
  ]
}
EOF
)

echo "$FINAL_RESPONSE" | jq .

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "FINAL ANSWER:"
echo "═══════════════════════════════════════════════════════════"
echo "$FINAL_RESPONSE" | jq -r '.message.content'
echo "═══════════════════════════════════════════════════════════"
