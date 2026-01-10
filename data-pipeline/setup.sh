#!/bin/bash
# Setup script for Toponymy development

set -e

echo "🚀 Setting up Toponymy..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

echo "✓ Node.js version: $(node --version)"

# Install root dependencies
echo ""
echo "📦 Installing root dependencies..."
npm install

# Install web dependencies
echo ""
echo "📦 Installing web dependencies..."
cd web
npm install
cd ..

# Install API dependencies
echo ""
echo "📦 Installing API dependencies..."
cd api
npm install
cd ..

# Create data directory for local development
echo ""
echo "📁 Creating local data directory..."
mkdir -p server/data

echo ""
echo "✅ Setup complete!"
echo ""
echo "🏃 To start development:"
echo "   npm run dev"
echo ""
echo "🔨 To build for production:"
echo "   npm run build"
echo ""
echo "📖 For deployment instructions, see README.md"
