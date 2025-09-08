const express = require('express');
const axios = require('axios');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');
const fs = require('fs'); // Add this import
require('dotenv').config();

// Create data directory if it doesn't exist - ADD THIS BEFORE DATABASE IMPORT
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 Created data directory:', dataDir);
}

// Import multi-user database module AFTER ensuring directory exists
const database = require('./database-multiuser');

const app = express();
const PORT = process.env.PORT || 3000;
const isDevelopment = process.env.NODE_ENV === 'development';

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Compression for performance
app.use(compression());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // Limit auth attempts
    message: 'Too many authentication attempts, please try again later.'
});

app.use('/api/', limiter);
app.use('/auth/', authLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
// app.use(express.static('public'));
// Serve static files for assets but not HTML pages directly
app.use('/style.css', express.static(path.join(__dirname, 'public', 'style.css')));
app.use('/app.js', express.static(path.join(__dirname, 'public', 'app.js')));
app.use('/dashboard.css', express.static(path.join(__dirname, 'public', 'dashboard.css')));
app.use('/dashboard.js', express.static(path.join(__dirname, 'public', 'dashboard.js')));

// Session configuration with SQLite store
app.use(session({
    store: new SQLiteStore({
        dir: path.join(__dirname, 'data'), // Use absolute path
        db: 'sessions.db',
        table: 'sessions',
        ttl: 7200000 // 2 hours
    }),
    secret: process.env.SESSION_SECRET || 'subscribe-to-kenzieduckmoo-on-twitch-or-mistressduckmoo-on-onlyfans-2-support-development',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: !isDevelopment, // Use secure cookies in production
        httpOnly: true,
        maxAge: 7200000, // 2 hours
        sameSite: 'lax'
    }
}));

// Initialize database on startup
database.initDatabase().then(() => {
    console.log('📊 Multi-user database initialized successfully');
    // Clean up expired sessions periodically
    setInterval(() => {
        database.cleanupSessions().catch(console.error);
    }, 3600000); // Every hour
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});

// Helper function to extract English text from Blizzard's localized objects
function extractEnglishText(obj) {
    if (!obj) return 'Unknown';
    if (typeof obj === 'string') return obj;
    if (obj.name && typeof obj.name === 'object' && obj.name.en_US) {
        return obj.name.en_US;
    }
    if (obj.en_US) return obj.en_US;
    if (obj.name && typeof obj.name === 'string') return obj.name;
    return 'Unknown';
}

// Middleware to check authentication
function requireAuth(req, res, next) {
    if (!req.session.userId || !req.session.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}

// Middleware to redirect to login if not authenticated
function requireAuthRedirect(req, res, next) {
    if (!req.session.userId || !req.session.accessToken) {
        return res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
    next();
}

// Serve different pages based on auth status
app.get('/', requireAuthRedirect, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/characters', requireAuthRedirect, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// OAuth endpoints
app.get('/auth/login', (req, res) => {
    const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    req.session.oauthState = state;
    
    const redirectUri = isDevelopment 
        ? process.env.BNET_REDIRECT_URI 
        : process.env.BNET_REDIRECT_URI_PROD || process.env.BNET_REDIRECT_URI;
    
    const authUrl = `https://${process.env.REGION}.battle.net/oauth/authorize?` +
        `client_id=${process.env.BNET_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=wow.profile openid&` +
        `state=${state}`;
    
    res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    
    // Verify state for CSRF protection
    if (!state || state !== req.session.oauthState) {
        return res.redirect('/?error=invalid_state');
    }
    
    if (!code) {
        return res.redirect('/?error=no_code');
    }
    
    delete req.session.oauthState;
    
    try {
        const redirectUri = isDevelopment 
            ? process.env.BNET_REDIRECT_URI 
            : process.env.BNET_REDIRECT_URI_PROD || process.env.BNET_REDIRECT_URI;
        
        // Exchange code for token
        const tokenResponse = await axios.post(
            `https://${process.env.REGION}.battle.net/oauth/token`,
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri,
                client_id: process.env.BNET_CLIENT_ID,
                client_secret: process.env.BNET_CLIENT_SECRET
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        const accessToken = tokenResponse.data.access_token;
        
        // Get user info from Battle.net
        const userInfoResponse = await axios.get(
            `https://${process.env.REGION}.battle.net/oauth/userinfo`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );
        
        const battlenetId = userInfoResponse.data.id;
        const battlenetTag = userInfoResponse.data.battletag;
        
        // Find or create user in database
        const user = await database.findOrCreateUser(battlenetId, battlenetTag);
        
        // Store user info in session
        req.session.userId = user.id;
        req.session.battlenetTag = user.battlenet_tag;
        req.session.accessToken = accessToken;
        
        console.log(`User ${user.battlenet_tag} logged in successfully`);
        res.redirect('/');
    } catch (error) {
        console.error('OAuth error:', error.response?.data || error.message);
        res.redirect('/?error=auth_failed');
    }
});

app.get('/auth/logout', (req, res) => {
    const userId = req.session.userId;
    req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        console.log(`User ${userId} logged out`);
        res.redirect('/');
    });
});



// API endpoints - all require authentication and are user-scoped
app.get('/api/auth/status', async (req, res) => {
    if (!req.session.userId || !req.session.accessToken) {
        return res.json({ authenticated: false });
    }
    
    try {
        // Verify token is still valid
        await axios.get(
            `https://${process.env.REGION}.api.blizzard.com/profile/user/wow?namespace=profile-${process.env.REGION}`,
            {
                headers: {
                    'Authorization': `Bearer ${req.session.accessToken}`
                }
            }
        );
        
        res.json({ 
            authenticated: true,
            battlenetTag: req.session.battlenetTag
        });
    } catch (error) {
        // Token expired
        req.session.destroy();
        res.json({ authenticated: false });
    }
});

app.get('/api/characters', requireAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    
    try {
        const profileResponse = await axios.get(
            `https://${process.env.REGION}.api.blizzard.com/profile/user/wow?namespace=profile-${process.env.REGION}`,
            {
                headers: {
                    'Authorization': `Bearer ${req.session.accessToken}`
                }
            }
        );
        
        const characters = [];
        const userId = req.session.userId;
        
        for (const account of profileResponse.data.wow_accounts) {
            for (const char of account.characters) {
                if (char.level >= 70) {
                    try {
                        // Get character details
                        const charDetails = await axios.get(
                            `https://${process.env.REGION}.api.blizzard.com/profile/wow/character/${char.realm.slug}/${char.name.toLowerCase()}?namespace=profile-${process.env.REGION}`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${req.session.accessToken}`
                                }
                            }
                        );
                        
                        // Get professions
                        let professions = [];
                        try {
                            const professionsResponse = await axios.get(
                                `https://${process.env.REGION}.api.blizzard.com/profile/wow/character/${char.realm.slug}/${char.name.toLowerCase()}/professions?namespace=profile-${process.env.REGION}`,
                                {
                                    headers: {
                                        'Authorization': `Bearer ${req.session.accessToken}`
                                    }
                                }
                            );
                            
                            if (professionsResponse.data.primaries) {
                                for (const prof of professionsResponse.data.primaries) {
                                    const professionName = extractEnglishText(prof.profession);
                                    const professionId = prof.profession.id;
                                    
                                    // Process tiers
                                    const tiers = prof.tiers ? prof.tiers.map(tier => ({
                                        name: extractEnglishText(tier.tier),
                                        id: tier.tier?.id,
                                        skillLevel: tier.skill_points || 0,
                                        maxSkill: tier.max_skill_points || 0,
                                        recipes: tier.known_recipes ? tier.known_recipes.length : 0
                                    })) : [];
                                    
                                    // Save each tier to database
                                    for (const tier of tiers) {
                                        await database.upsertProfessionTier(
                                            userId,
                                            `${char.realm.slug}-${char.name.toLowerCase()}`,
                                            professionName,
                                            professionId,
                                            tier
                                        );
                                    }
                                    
                                    professions.push({
                                        name: professionName,
                                        id: professionId,
                                        tiers: tiers,
                                        totalRecipes: tiers.reduce((sum, tier) => sum + tier.recipes, 0)
                                    });
                                }
                            }
                        } catch (profErr) {
                            console.error(`Failed to get professions for ${char.name}:`, profErr.message);
                        }
                        
                        const characterData = {
                            id: `${char.realm.slug}-${char.name.toLowerCase()}`,
                            name: char.name,
                            realm: extractEnglishText(charDetails.data.realm),
                            level: charDetails.data.level,
                            class: extractEnglishText(charDetails.data.character_class),
                            race: extractEnglishText(charDetails.data.race),
                            faction: extractEnglishText(charDetails.data.faction),
                            averageItemLevel: charDetails.data.average_item_level,
                            equippedItemLevel: charDetails.data.equipped_item_level,
                            professions: professions
                        };
                        
                        // Save to database for this user
                        await database.upsertCharacter(userId, characterData);
                        
                        characters.push(characterData);
                    } catch (err) {
                        console.error(`Failed to get details for ${char.name}:`, err.message);
                    }
                }
            }
        }
        
        // Update combinations for this user
        await database.updateCombinations(userId, characters);
        
        // Sort by item level
        characters.sort((a, b) => (b.averageItemLevel || 0) - (a.averageItemLevel || 0));
        
        res.json(characters);
    } catch (error) {
        console.error('API error:', error.response?.data || error.message);
        if (error.response?.status === 401) {
            req.session.destroy();
            res.status(401).json({ error: 'Token expired, please login again' });
        } else {
            res.status(500).json({ error: 'Failed to fetch characters' });
        }
    }
});

// Notes endpoints - user-scoped
app.get('/api/notes/:characterId', requireAuth, async (req, res) => {
    try {
        const notes = await database.getNotes(req.session.userId, req.params.characterId);
        res.json({ notes: notes || '' });
    } catch (error) {
        console.error('Failed to get notes:', error);
        res.json({ notes: '' });
    }
});

app.post('/api/notes/:characterId', requireAuth, async (req, res) => {
    try {
        await database.saveNotes(req.session.userId, req.params.characterId, req.body.notes);
        res.json({ success: true });
    } catch (error) {
        console.error('Notes save error:', error);
        res.status(500).json({ error: 'Failed to save notes' });
    }
});

// Profession summary - user-scoped
app.get('/api/professions-summary', requireAuth, async (req, res) => {
    try {
        const summary = await database.getProfessionSummary(req.session.userId);
        res.json(summary);
    } catch (error) {
        console.error('Profession summary error:', error);
        res.status(500).json({ error: 'Failed to get profession summary' });
    }
});

// Class/race/faction combinations - user-scoped
app.get('/api/combinations', requireAuth, async (req, res) => {
    try {
        const combinations = await database.getCombinationMatrix(req.session.userId);
        res.json(combinations);
    } catch (error) {
        console.error('Combinations error:', error);
        res.status(500).json({ error: 'Failed to get combinations' });
    }
});

// Get cached characters from database (fast loading) - user-scoped
app.get('/api/characters-cached', requireAuth, async (req, res) => {
    try {
        const characters = await database.getAllCharacters(req.session.userId);
        res.json(characters);
    } catch (error) {
        console.error('Failed to get cached characters:', error);
        res.status(500).json({ error: 'Failed to get characters from cache' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`✨ WoW Character Manager (Multi-User) running on http://localhost:${PORT}`);
    console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📁 Database: ${path.join(__dirname, 'data', 'wow_characters.db')}`);
    
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        console.warn('⚠️  WARNING: SESSION_SECRET is not set or too short. Set a strong secret in production!');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        database.db.close(() => {
            console.log('Database connection closed');
            process.exit(0);
        });
    });
});

module.exports = app;