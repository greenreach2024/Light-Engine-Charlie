#!/bin/bash

# Setup script for Python backend dependencies
echo "🐍 Setting up Python backend for Light Engine Charlie..."

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed"
    exit 1
fi

echo "✅ Python 3 found: $(python3 --version)"

# Check if pip is available
if ! command -v pip3 &> /dev/null; then
    echo "❌ pip3 is required but not installed"
    exit 1
fi

echo "✅ pip3 found"

# Install dependencies from requirements.txt
echo "📦 Installing Python dependencies..."
pip3 install -r requirements.txt

if [ $? -eq 0 ]; then
    echo "✅ All Python dependencies installed successfully"
else
    echo "⚠️ Some dependencies may have failed to install"
    echo "🔧 You can install individual packages manually:"
    echo "   pip3 install fastapi uvicorn paho-mqtt python-kasa requests pyyaml"
    echo "   pip3 install bleak zeroconf  # Optional for BLE and mDNS discovery"
fi

# Test the backend
echo "🧪 Testing backend compilation..."
python3 -m compileall backend

if [ $? -eq 0 ]; then
    echo "✅ Backend compiles successfully"
else
    echo "❌ Backend compilation failed"
    exit 1
fi

# Test backend startup (quick check)
echo "🚀 Testing backend startup..."
timeout 5s python3 -m backend &
BACKEND_PID=$!

sleep 2

if ps -p $BACKEND_PID > /dev/null; then
    echo "✅ Backend starts successfully"
    kill $BACKEND_PID 2>/dev/null
else
    echo "❌ Backend failed to start"
fi

echo ""
echo "🎉 Python backend setup complete!"
echo ""
echo "To start the backend:"
echo "   python3 -m backend"
echo ""
echo "The backend will run on http://localhost:8000"
echo "Node.js server will proxy to it for device discovery"