#!/bin/bash

# PerkUp Railway Deployment Script
# Deploys backend and bot services to Railway
# Usage: ./scripts/deploy.sh [server|bot|client|backend|all]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${BLUE}🚀 PerkUp Railway Deployment Script${NC}"
echo "======================================"
echo ""

# Check if Railway CLI is installed
check_railway_cli() {
    if ! command -v railway &> /dev/null; then
        echo -e "${YELLOW}⚠️ Railway CLI not found. Installing...${NC}"
        npm install -g @railway/cli
        echo -e "${GREEN}✅ Railway CLI installed${NC}"
    fi
}

# Check if logged in to Railway
check_railway_auth() {
    if ! railway whoami &> /dev/null; then
        echo -e "${YELLOW}📝 Please login to Railway:${NC}"
        railway login
    else
        echo -e "${GREEN}✅ Logged in to Railway${NC}"
    fi
}

# Deploy Server (Backend API)
deploy_server() {
    echo ""
    echo -e "${BLUE}📦 Deploying Server (Backend API)...${NC}"
    cd "$PROJECT_DIR/server"

    # Build locally first to check for errors
    echo "   Building TypeScript..."
    npm run build

    # Generate Prisma client
    echo "   Generating Prisma client..."
    npx prisma generate

    # Deploy to Railway
    echo "   Uploading to Railway..."
    railway up --service perkup-server --detach

    cd "$PROJECT_DIR"
    echo -e "${GREEN}✅ Server deployed!${NC}"
}

# Deploy Bot (Telegram Bot)
deploy_bot() {
    echo ""
    echo -e "${BLUE}🤖 Deploying Bot (Telegram Bot)...${NC}"
    cd "$PROJECT_DIR/bot"

    # Build locally first to check for errors
    echo "   Building TypeScript..."
    npm run build

    # Deploy to Railway
    echo "   Uploading to Railway..."
    railway up --service perkup-bot --detach

    cd "$PROJECT_DIR"
    echo -e "${GREEN}✅ Bot deployed!${NC}"
}

# Deploy Client (Mini App)
deploy_client() {
    echo ""
    echo -e "${BLUE}🌐 Deploying Client (Mini App)...${NC}"
    cd "$PROJECT_DIR/client"

    # Build locally first to check for errors
    echo "   Building React app..."
    npm run build

    # Deploy to Railway
    echo "   Uploading to Railway..."
    railway up --service perkup-client --detach

    cd "$PROJECT_DIR"
    echo -e "${GREEN}✅ Client deployed!${NC}"
}

# Install dependencies for all services
install_deps() {
    echo ""
    echo -e "${BLUE}📥 Installing dependencies...${NC}"

    echo "   Server dependencies..."
    cd "$PROJECT_DIR/server" && npm install

    echo "   Bot dependencies..."
    cd "$PROJECT_DIR/bot" && npm install

    echo "   Client dependencies..."
    cd "$PROJECT_DIR/client" && npm install

    cd "$PROJECT_DIR"
    echo -e "${GREEN}✅ All dependencies installed!${NC}"
}

# Print environment variables reminder
print_env_reminder() {
    echo ""
    echo -e "${YELLOW}📋 Required Environment Variables:${NC}"
    echo ""
    echo "   Server (perkup-server):"
    echo "   ├── DATABASE_URL       - PostgreSQL connection string"
    echo "   ├── PORT               - Server port (auto by Railway)"
    echo "   └── NODE_ENV           - production"
    echo ""
    echo "   Bot (perkup-bot):"
    echo "   ├── BOT_TOKEN          - Telegram bot token from @BotFather"
    echo "   └── NODE_ENV           - production"
    echo ""
    echo "   Client (perkup-client):"
    echo "   ├── VITE_API_URL       - Backend API URL"
    echo "   └── NODE_ENV           - production"
    echo ""
}

# Main execution
check_railway_cli
check_railway_auth

case "${1:-backend}" in
    server)
        deploy_server
        ;;
    bot)
        deploy_bot
        ;;
    client)
        deploy_client
        ;;
    backend)
        # Deploy server and bot together
        echo -e "${BLUE}🔄 Deploying backend services (server + bot)...${NC}"
        deploy_server
        deploy_bot
        echo ""
        echo -e "${GREEN}🎉 Backend services deployed successfully!${NC}"
        ;;
    all)
        echo -e "${BLUE}🔄 Deploying all services...${NC}"
        deploy_server
        deploy_bot
        deploy_client
        echo ""
        echo -e "${GREEN}🎉 All services deployed successfully!${NC}"
        ;;
    install)
        install_deps
        ;;
    help|--help|-h)
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  server   - Deploy only the backend API"
        echo "  bot      - Deploy only the Telegram bot"
        echo "  client   - Deploy only the Mini App"
        echo "  backend  - Deploy server + bot (default)"
        echo "  all      - Deploy all services"
        echo "  install  - Install dependencies for all services"
        echo "  help     - Show this help message"
        echo ""
        exit 0
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac

print_env_reminder

echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. Set environment variables in Railway dashboard"
echo "2. Add PostgreSQL database to your Railway project"
echo "3. Configure Telegram bot with @BotFather"
echo "4. Set Web App URL in bot settings"
echo ""
echo -e "${GREEN}Done! Check Railway dashboard for deployment status.${NC}"
