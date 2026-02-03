#!/bin/bash

# PerkUp Railway Deployment Script
# Usage: ./scripts/deploy.sh [server|bot|client|all]

set -e

echo "🚀 PerkUp Deployment Script"
echo "=========================="

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    npm install -g @railway/cli
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo "📝 Please login to Railway:"
    railway login
fi

deploy_server() {
    echo "📦 Deploying Server..."
    cd server
    railway up --service perkup-server
    cd ..
    echo "✅ Server deployed!"
}

deploy_bot() {
    echo "🤖 Deploying Bot..."
    cd bot
    railway up --service perkup-bot
    cd ..
    echo "✅ Bot deployed!"
}

deploy_client() {
    echo "🌐 Deploying Client..."
    cd client
    railway up --service perkup-client
    cd ..
    echo "✅ Client deployed!"
}

case "${1:-all}" in
    server)
        deploy_server
        ;;
    bot)
        deploy_bot
        ;;
    client)
        deploy_client
        ;;
    all)
        echo "🔄 Deploying all services..."
        deploy_server
        deploy_bot
        deploy_client
        echo ""
        echo "🎉 All services deployed successfully!"
        ;;
    *)
        echo "Usage: $0 [server|bot|client|all]"
        exit 1
        ;;
esac

echo ""
echo "📋 Next steps:"
echo "1. Set environment variables in Railway dashboard"
echo "2. Configure your Telegram bot with @BotFather"
echo "3. Test your Mini App!"
