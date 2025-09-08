# WoW Character Manager

A multi-user web application for managing World of Warcraft characters with Battle.net OAuth integration, profession tracking, and personal notes.

## Features

- 🔐 **Secure Battle.net OAuth Authentication** - Login with your Battle.net account
- 👥 **Multi-User Support** - Each user's data is completely separated
- 📊 **Character Overview** - View all your level 70+ characters with item levels
- 📝 **Character Notes** - Keep personal notes for each character
- 🔨 **Profession Tracking** - Track all professions across expansions with skill levels
- 📈 **Dashboard Analytics** - View profession coverage and character statistics
- 🎯 **"One of Everything" Challenge** - Track class/race/faction combinations
- 💾 **Persistent Storage** - All data saved in SQLite database

## Prerequisites

- Node.js 18.0.0 or higher
- Battle.net Developer Account
- Battle.net OAuth Application

## Setup

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/wow-character-manager.git
cd wow-character-manager
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up Battle.net OAuth

1. Go to [Battle.net Developer Portal](https://develop.battle.net/)
2. Create a new application
3. Set redirect URI to `http://localhost:3000/auth/callback` for development
4. Note your Client ID and Client Secret

### 4. Configure environment variables

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Edit `.env` with your Battle.net credentials:
```
BNET_CLIENT_ID=your_client_id_here
BNET_CLIENT_SECRET=your_client_secret_here
BNET_REDIRECT_URI=http://localhost:3000/auth/callback
REGION=us
SESSION_SECRET=generate_a_secure_random_string_here
```

### 5. Initialize the database
```bash
npm run migrate
```

### 6. Start the server
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

Visit `http://localhost:3000` to use the application.

## Security Features

- ✅ Helmet.js for security headers
- ✅ Rate limiting on API endpoints
- ✅ Secure session management with SQLite store
- ✅ CSRF protection via state parameter
- ✅ Input validation and sanitization
- ✅ User data isolation
- ✅ Secure cookie configuration

## Deployment

### Environment Variables for Production

Update your `.env` for production:
```
NODE_ENV=production
PRODUCTION_URL=https://your-domain.com
BNET_REDIRECT_URI_PROD=https://your-domain.com/auth/callback
SESSION_SECRET=use_a_very_long_random_string_here
```

### Deploy to Heroku

```bash
heroku create your-app-name
heroku config:set BNET_CLIENT_ID=your_client_id
heroku config:set BNET_CLIENT_SECRET=your_client_secret
heroku config:set SESSION_SECRET=your_session_secret
heroku config:set REGION=us
git push heroku main
```

### Deploy to Railway/Render

These platforms automatically detect Node.js apps. Just:
1. Connect your GitHub repository
2. Set environment variables in the platform's dashboard
3. Deploy

## Project Structure

```
wow-character-manager/
├── server-secure.js      # Main server with multi-user support
├── database-multiuser.js # Database schema and helpers
├── public/              # Frontend files
│   ├── index.html
│   ├── app.js
│   └── style.css
├── data/               # Database files (gitignored)
├── .env               # Environment variables (gitignored)
└── package.json       # Dependencies and scripts
```

## API Endpoints

All endpoints require authentication except `/auth/*` routes:

- `GET /auth/login` - Start OAuth flow
- `GET /auth/callback` - OAuth callback
- `GET /auth/logout` - Logout user
- `GET /api/auth/status` - Check authentication status
- `GET /api/characters` - Fetch and update characters from Battle.net
- `GET /api/characters-cached` - Get cached characters from database
- `GET /api/notes/:characterId` - Get character notes
- `POST /api/notes/:characterId` - Save character notes
- `GET /api/professions-summary` - Get profession analytics
- `GET /api/combinations` - Get class/race/faction matrix

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Blizzard Entertainment for the Battle.net API
- The WoW community

## Support

For issues and questions, please open an issue on GitHub.