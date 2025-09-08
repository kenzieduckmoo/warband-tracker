# WoW Character Manager

A secure, multi-user web application for World of Warcraft players to manage characters, track professions, and organize character notes using Battle.net OAuth authentication.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)

## Features

### 📊 Dashboard Overview
- Character statistics at a glance
- Race, class, and faction distribution
- Profession coverage across all expansions
- Top characters by item level
- Recent character notes preview

### 📝 Character Management
- Automatic import of level 70+ characters
- Real-time Battle.net data sync
- Individual character notes
- Profession tracking with skill levels per expansion
- Item level tracking

### 🔐 Security & Privacy
- Battle.net OAuth 2.0 authentication
- Multi-user support with data isolation
- Secure session management
- No password storage - uses Battle.net login
- Rate limiting and security headers

## Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn
- Battle.net Developer Account ([create one here](https://develop.battle.net/))

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/kenzieduckmoo/warband-tracker.git
cd warband-tracker
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Battle.net OAuth

1. Go to [Battle.net Developer Portal](https://develop.battle.net/)
2. Create a new application (or use existing)
3. Add redirect URIs:
   - For local development: `http://localhost:3000/auth/callback`
   - For production: `https://yourdomain.com/auth/callback`
4. Save your Client ID and Client Secret

### 4. Set Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Battle.net OAuth
BNET_CLIENT_ID=your_client_id_here
BNET_CLIENT_SECRET=your_client_secret_here
BNET_REDIRECT_URI=http://localhost:3000/auth/callback
REGION=us  # Options: us, eu, kr, tw

# Server Configuration
PORT=3000
NODE_ENV=development

# Security (generate random strings)
SESSION_SECRET=generate_64_character_random_string_here

# Production (when deploying)
# NODE_ENV=production
# BNET_REDIRECT_URI_PROD=https://yourdomain.com/auth/callback
```

Generate secure random strings at: https://randomkeygen.com/

### 5. Start the Application

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

Visit `http://localhost:3000` in your browser.

## Deployment

### Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

1. Click the button above
2. Connect your GitHub repository
3. Add environment variables in Railway dashboard
4. Deploy!

### Deploy to Render

1. Create a new Web Service on [Render](https://render.com/)
2. Connect your GitHub repository
3. Use the following settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables
5. Deploy!

### Deploy to Heroku

```bash
# Create Heroku app
heroku create your-app-name

# Set environment variables
heroku config:set BNET_CLIENT_ID=your_client_id
heroku config:set BNET_CLIENT_SECRET=your_client_secret
heroku config:set SESSION_SECRET=your_session_secret
heroku config:set NODE_ENV=production
heroku config:set REGION=us

# Deploy
git push heroku main
```

### Deploy to VPS (Ubuntu/Debian)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and setup
git clone https://github.com/yourusername/wow-character-manager.git
cd wow-character-manager
npm install

# Use PM2 for process management
npm install -g pm2
pm2 start server.js --name wow-manager
pm2 save
pm2 startup
```

## Project Structure

```
wow-character-manager/
├── server.js              # Main application server
├── database-multiuser.js  # Database operations
├── public/               
│   ├── dashboard.html     # Main dashboard page
│   ├── dashboard.js       # Dashboard functionality
│   ├── dashboard.css      # Dashboard styles
│   ├── index.html         # Character manager page
│   ├── app.js            # Character manager functionality
│   └── login.html        # Login page
├── data/                 # Database files (auto-created)
├── .env                  # Environment variables (create from .env.example)
├── .env.example          # Environment template
├── package.json          # Dependencies
└── README.md            # Documentation
```

## API Endpoints

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/` | GET | Dashboard (redirects to login if not authenticated) | No |
| `/characters` | GET | Character manager page | Yes |
| `/auth/login` | GET | Initiates Battle.net OAuth | No |
| `/auth/callback` | GET | OAuth callback endpoint | No |
| `/auth/logout` | GET | Logs out user | Yes |
| `/api/auth/status` | GET | Check authentication status | No |
| `/api/characters` | GET | Fetch characters from Battle.net | Yes |
| `/api/characters-cached` | GET | Get cached characters from database | Yes |
| `/api/professions-summary` | GET | Get profession analytics | Yes |
| `/api/combinations` | GET | Get class/race/faction matrix | Yes |
| `/api/notes/:characterId` | GET/POST | Get/save character notes | Yes |

## Security Features

- **Helmet.js** - Security headers
- **Rate Limiting** - API request throttling
- **Session Security** - Secure cookies with httpOnly flag
- **CSRF Protection** - State parameter validation
- **SQL Injection Prevention** - Parameterized queries
- **XSS Protection** - Content Security Policy

## Troubleshooting

### "Cannot find module" error
```bash
npm install
```

### Database errors
```bash
# Delete database and let it recreate
rm data/*.db
npm start
```

### OAuth redirect mismatch
- Ensure redirect URI in `.env` matches exactly what's configured in Battle.net Developer Portal
- Include the protocol (http/https) and port

### Session issues
- Clear browser cookies for localhost
- Restart the server
- Check SESSION_SECRET is set in `.env`

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Support

For issues, questions, or suggestions:
- Open an issue on [GitHub](https://github.com/kenzieduckmoo/warband-tracker/issues)
- Contact via Discord: https://discord.gg/TbNEqpp2BB

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Blizzard Entertainment for the Battle.net API
- The WoW community
- Contributors and testers

## Disclaimer

This project is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft and Battle.net are trademarks or registered trademarks of Blizzard Entertainment, Inc.

---

Made with ❤️ for the WoW community