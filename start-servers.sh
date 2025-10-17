#!/bin/bash

# Light Engine Charlie - Start Both Servers
# This script starts both the Node.js server and Python backend

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Light Engine Charlie Servers...${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo -e "${RED}❌ Python is not installed${NC}"
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if .env file exists and load it
if [ -f .env ]; then
    echo -e "${BLUE}📋 Loading environment variables from .env${NC}"
    export $(cat .env | grep -v '^#' | xargs)
fi

# Kill any existing processes on ports 8091 and 8000
echo -e "${BLUE}🧹 Cleaning up existing processes...${NC}"
lsof -ti:8091 | xargs kill -9 2>/dev/null || true
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
sleep 1

# Create log directory
mkdir -p logs

# Start Python backend
echo -e "${GREEN}🐍 Starting Python backend on port 8000...${NC}"
if command -v python3 &> /dev/null; then
    nohup python3 -m backend > logs/python-backend.log 2>&1 &
else
    nohup python -m backend > logs/python-backend.log 2>&1 &
fi
PYTHON_PID=$!
echo -e "${GREEN}   Python backend started (PID: $PYTHON_PID)${NC}"

# Wait a moment for Python to start
sleep 2

# Check if Python backend is responding
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Python backend is responding${NC}"
else
    echo -e "${RED}   ⚠️  Python backend may not be ready yet${NC}"
fi

# Start Node.js server
echo -e "${GREEN}🟢 Starting Node.js server on port 8091...${NC}"
nohup npm run start > logs/node-server.log 2>&1 &
NODE_PID=$!
echo -e "${GREEN}   Node.js server started (PID: $NODE_PID)${NC}"

# Wait a moment for Node to start
sleep 2

# Check if Node server is responding
if curl -s http://localhost:8091 > /dev/null 2>&1; then
    echo -e "${GREEN}   ✅ Node.js server is responding${NC}"
else
    echo -e "${RED}   ⚠️  Node.js server may not be ready yet${NC}"
fi

echo ""
echo -e "${GREEN}✨ Both servers are starting!${NC}"
echo ""
echo -e "${BLUE}📊 Server Status:${NC}"
echo -e "   Python Backend: http://localhost:8000"
echo -e "   Node.js Server: http://localhost:8091"
echo ""
echo -e "${BLUE}📝 Logs:${NC}"
echo -e "   Python: tail -f logs/python-backend.log"
echo -e "   Node.js: tail -f logs/node-server.log"
echo ""
echo -e "${BLUE}🛑 To stop servers:${NC}"
echo -e "   kill $PYTHON_PID $NODE_PID"
echo ""
echo -e "${GREEN}🌐 Open browser to: http://localhost:8091${NC}"
