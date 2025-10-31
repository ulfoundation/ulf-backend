#!/bin/bash

# ===============================================
# 🚀 Auto Start ngrok + Sync Backend + Frontend
# ===============================================

BACKEND_PORT=5020
FRONTEND_DIR="../client"  # adjust if your frontend is in another path
LOG_FILE="ngrok.log"

echo "🚀 Starting ngrok tunnel on port $BACKEND_PORT..."
ngrok http $BACKEND_PORT --log=stdout > $LOG_FILE 2>&1 &

# Wait for ngrok to initialize
echo "⏳ Waiting for ngrok to initialize..."
for i in {1..20}; do
  sleep 1
  if curl -s http://127.0.0.1:4040/api/tunnels > /dev/null 2>&1; then
    break
  fi
  echo "⌛ Still waiting ($i)..."
done

# Fetch ngrok public URL
NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[0].public_url')

if [[ "$NGROK_URL" == "null" || -z "$NGROK_URL" ]]; then
  echo "❌ Failed to detect ngrok URL. Make sure ngrok is running correctly."
  echo "🔍 Check logs: $LOG_FILE"
  exit 1
fi

# Update .env file
if grep -q "API_BASE_URL=" .env; then
  sed -i '' "s|^API_BASE_URL=.*|API_BASE_URL=$NGROK_URL|" .env
else
  echo "API_BASE_URL=$NGROK_URL" >> .env
fi

echo "✅ Updated .env with: $NGROK_URL"

# Restart backend (Node.js)
echo "🔄 Restarting backend..."
pkill -f "node src/index.js" 2>/dev/null
npm run dev &

# Restart frontend (Vite)
if [ -d "$FRONTEND_DIR" ]; then
  echo "🎨 Restarting Vite frontend..."
  cd "$FRONTEND_DIR"
  pkill -f "vite" 2>/dev/null
  npm run dev &
  cd - > /dev/null
else
  echo "⚠️ Frontend directory not found at $FRONTEND_DIR. Skipping Vite restart."
fi

echo ""
echo "🎉 Setup complete!"
echo "🌍 Public URL: $NGROK_URL"
echo "💻 Backend running on http://localhost:$BACKEND_PORT"
echo "🎨 Frontend running on http://localhost:5173"
