const express = require('express');
const axios = require('axios');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log('📁 Created data directory:', dataDir);
}

const database = require('./database-postgresql');

const app = express();
app.set('trust proxy', 1); // ADD THIS LINE - trust first proxy
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

// Rate limiting - more generous in development
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: isDevelopment ? 1000 : 200, // More generous limits for development
    message: 'Too many requests from this IP, please try again later.'
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10, // Slightly more generous for auth
    message: 'Too many authentication attempts, please try again later.'
});

// Only apply rate limiting to specific sensitive endpoints
app.use('/auth/', authLimiter);
// Don't rate limit all API endpoints in development
if (!isDevelopment) {
    app.use('/api/', limiter);
}

// Body parsing
app.use(express.json({ limit: '10mb' }));
// app.use(express.static('public'));
// Serve static files for assets but not HTML pages directly
app.use('/style.css', express.static(path.join(__dirname, 'public', 'style.css')));
app.use('/app.js', express.static(path.join(__dirname, 'public', 'app.js')));
app.use('/dashboard.css', express.static(path.join(__dirname, 'public', 'dashboard.css')));
app.use('/dashboard.js', express.static(path.join(__dirname, 'public', 'dashboard.js')));
app.use('/footer.js', express.static(path.join(__dirname, 'public', 'footer.js')));

// Session configuration with PostgreSQL store
 app.use(session({
    store: new pgSession({
        conString: process.env.DATABASE_URL + '?sslmode=require',
        tableName: 'session',
        ttl: 7200, // 2 hours in seconds
        createTableIfMissing: true
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
    console.log('📊 PostgreSQL database initialized successfully');

    // Check recipe cache status and update if needed
    checkAndUpdateRecipeCache();
    
    // Clean up expired sessions periodically
    setInterval(() => {
        database.cleanupSessions().catch(console.error);
    }, 3600000); // Every hour
    
    // Check recipe cache weekly
    setInterval(() => {
        checkAndUpdateRecipeCache();
    }, 7 * 24 * 60 * 60 * 1000); // Weekly
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});

// Function to check and update recipe cache
async function checkAndUpdateRecipeCache() {
    try {
        const cacheStatus = await database.getRecipeCacheStatus();
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        if (!cacheStatus.last_cached || new Date(cacheStatus.last_cached) < oneWeekAgo) {
            console.log('Recipe cache is outdated or empty. Starting background update...');
            await updateRecipeCache();
        } else {
            console.log(`Recipe cache is current. ${cacheStatus.total_recipes} recipes cached.`);
        }
    } catch (error) {
        console.error('Failed to check recipe cache status:', error);
    }
}

// Background recipe cache update function
async function updateRecipeCache() {
    try {
        console.log('Starting background recipe cache update...');
        
        const professionsResponse = await axios.get(
            `https://${process.env.REGION}.api.blizzard.com/data/wow/profession/?namespace=static-${process.env.REGION}`,
            {
                headers: {
                    'Authorization': `Bearer ${await getClientCredentialsToken()}`
                }
            }
        );
        
        let totalRecipesCached = 0;
        
        for (const profession of professionsResponse.data.professions) {
            if ([2777, 2787, 2791, 2819, 2821, 2870, 2847, 2811, 2886].includes(profession.id)) {
                continue;
            }
            
            try {
                const professionResponse = await axios.get(
                    `https://${process.env.REGION}.api.blizzard.com/data/wow/profession/${profession.id}?namespace=static-${process.env.REGION}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${await getClientCredentialsToken()}`
                        }
                    }
                );
                
                for (const skillTier of professionResponse.data.skill_tiers) {
                    try {
                        const tierResponse = await axios.get(
                            `https://${process.env.REGION}.api.blizzard.com/data/wow/profession/${profession.id}/skill-tier/${skillTier.id}?namespace=static-${process.env.REGION}`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${await getClientCredentialsToken()}`
                                }
                            }
                        );
                        
                        // Format tier data with extracted text for proper caching
                        const tierData = {
                            id: skillTier.id,
                            name: extractEnglishText(skillTier),
                            categories: tierResponse.data.categories || []
                        };
                        
                        await database.cacheRecipes(profession.id, extractEnglishText(profession), tierData);
                        
                        const recipeCount = tierResponse.data.categories?.reduce(
                            (total, cat) => total + (cat.recipes?.length || 0), 0
                        ) || 0;
                        
                        totalRecipesCached += recipeCount;
                        
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (tierErr) {
                        console.error(`Failed to cache tier ${skillTier.name}:`, tierErr.message);
                    }
                }
            } catch (profErr) {
                console.error(`Failed to process profession ${profession.name}:`, profErr.message);
            }
        }
        
        console.log(`Background recipe cache complete! Cached ${totalRecipesCached} recipes.`);
        
    } catch (error) {
        console.error('Background recipe caching error:', error.message);
    }
}

// Client credentials token for public endpoints like WoW Token
let clientCredentialsToken = null;
let clientCredentialsExpiry = 0;

async function getClientCredentialsToken(region = 'us') {
    if (clientCredentialsToken && Date.now() < clientCredentialsExpiry) {
        return clientCredentialsToken;
    }
    
    try {
        const response = await axios.post(
            `https://${region}.battle.net/oauth/token`,
            new URLSearchParams({
                grant_type: 'client_credentials'
            }),
            {
                auth: {
                    username: process.env.BNET_CLIENT_ID,
                    password: process.env.BNET_CLIENT_SECRET
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        clientCredentialsToken = response.data.access_token;
        // Set expiry to 5 minutes before actual expiry for safety
        clientCredentialsExpiry = Date.now() + (response.data.expires_in - 300) * 1000;
        
        return clientCredentialsToken;
    } catch (error) {
        console.error('Failed to get client credentials token:', error.response?.data || error.message);
        throw error;
    }
}

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

// Helper function to get user's region for API calls
async function getUserRegionForAPI(userId) {
    try {
        const region = await database.getUserRegion(userId);
        return region || 'us';
    } catch (error) {
        console.error('Failed to get user region, defaulting to US:', error);
        return 'us';
    }
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
    const region = req.query.region || 'us'; // Default to US if no region specified
    
    // Validate region
    if (!['us', 'eu'].includes(region)) {
        return res.redirect('/?error=invalid_region');
    }
    
    const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    req.session.oauthState = state;
    req.session.oauthRegion = region; // Store region for callback
    
    const redirectUri = isDevelopment 
        ? process.env.BNET_REDIRECT_URI 
        : process.env.BNET_REDIRECT_URI_PROD || process.env.BNET_REDIRECT_URI;
    
    const authUrl = `https://${region}.battle.net/oauth/authorize?` +
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
    
    // Get the region from session
    const region = req.session.oauthRegion || 'us';
    
    // Clean up session variables
    delete req.session.oauthState;
    delete req.session.oauthRegion;
    
    try {
        const redirectUri = isDevelopment 
            ? process.env.BNET_REDIRECT_URI 
            : process.env.BNET_REDIRECT_URI_PROD || process.env.BNET_REDIRECT_URI;
        
        // Exchange code for token using the same region as authorization
        const tokenResponse = await axios.post(
            `https://${region}.battle.net/oauth/token`,
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
        
        // Get user info from Battle.net using the same region
        const userInfoResponse = await axios.get(
            `https://${region}.battle.net/oauth/userinfo`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );
        
        const battlenetId = userInfoResponse.data.id;
        const battlenetTag = userInfoResponse.data.battletag;
        
        // Find or create user in database with their login region as default
        const user = await database.findOrCreateUser(battlenetId, battlenetTag);
        
        // Set the user's region to their login region if not already set
        const currentUserRegion = await database.getUserRegion(user.id);
        if (!currentUserRegion || currentUserRegion === 'us') {
            await database.updateUserRegion(user.id, region);
        }
        
        // Store user info in session
        req.session.userId = user.id;
        req.session.battlenetTag = user.battlenet_tag;
        req.session.accessToken = accessToken;
        
        console.log(`User ${user.battlenet_tag} logged in successfully from ${region.toUpperCase()} region`);
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
        const userId = req.session.userId;
        const userRegion = await getUserRegionForAPI(userId);
        
        // Verify token is still valid
        await axios.get(
            `https://${userRegion}.api.blizzard.com/profile/user/wow?namespace=profile-${userRegion}`,
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
        const userId = req.session.userId;
        const userRegion = await getUserRegionForAPI(userId);
        
        const profileResponse = await axios.get(
            `https://${userRegion}.api.blizzard.com/profile/user/wow?namespace=profile-${userRegion}`,
            {
                headers: {
                    'Authorization': `Bearer ${req.session.accessToken}`
                }
            }
        );
        
        const characters = [];
        
        for (const account of profileResponse.data.wow_accounts) {
            for (const char of account.characters) {
                if (char.level >= 10) {
                    try {
                        // Get character details
                        const charDetails = await axios.get(
                            `https://${userRegion}.api.blizzard.com/profile/wow/character/${char.realm.slug}/${char.name.toLowerCase()}?namespace=profile-${userRegion}`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${req.session.accessToken}`
                                }
                            }
                        );
                        
                        // Get character titles
                        let titleData = null;
                        try {
                            const titlesResponse = await axios.get(
                                `https://${userRegion}.api.blizzard.com/profile/wow/character/${char.realm.slug}/${char.name.toLowerCase()}/titles?namespace=profile-${userRegion}`,
                                {
                                    headers: {
                                        'Authorization': `Bearer ${req.session.accessToken}`
                                    }
                                }
                            );
                            
                            if (titlesResponse.data.active_title) {
                                titleData = {
                                    name: extractEnglishText(titlesResponse.data.active_title),
                                    display_string: titlesResponse.data.active_title.display_string
                                };
                            }
                        } catch (titleErr) {
                            console.error(`Failed to get titles for ${char.name}:`, titleErr.message);
                        }
                        
                        // Get professions
                        let professions = [];
                        try {
                            const professionsResponse = await axios.get(
                                `https://${userRegion}.api.blizzard.com/profile/wow/character/${char.realm.slug}/${char.name.toLowerCase()}/professions?namespace=profile-${userRegion}`,
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
                                    
                                    // Save each tier to database AND store individual known recipes
                                    for (const tier of tiers) {
                                        await database.upsertProfessionTier(
                                            userId,
                                            `${char.realm.slug}-${char.name.toLowerCase()}`,
                                            professionName,
                                            professionId,
                                            tier
                                        );
                                        
                                        // Store individual known recipes if available
                                        const originalTier = prof.tiers.find(t => t.tier?.id === tier.id);
                                        if (originalTier && originalTier.known_recipes) {
                                            const knownRecipeIds = originalTier.known_recipes.map(recipe => recipe.id);
                                            await database.upsertKnownRecipes(
                                                userId,
                                                `${char.realm.slug}-${char.name.toLowerCase()}`,
                                                professionId,
                                                tier.id,
                                                knownRecipeIds
                                            );
                                        }
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
                            title: titleData,
                            guild: charDetails.data.guild ? extractEnglishText(charDetails.data.guild) : null,
                            activeSpec: charDetails.data.active_spec ? extractEnglishText(charDetails.data.active_spec) : null,
                            covenant: charDetails.data.covenant_progress ? extractEnglishText(charDetails.data.covenant_progress.chosen_covenant) : null,
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

// Bulk notes endpoint - get all notes for user's characters
app.get('/api/notes-all', requireAuth, async (req, res) => {
    try {
        const notes = await database.getAllNotes(req.session.userId);
        res.json(notes);
    } catch (error) {
        console.error('Failed to get all notes:', error);
        res.json({});
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

// Enhanced profession summary with recipe completion
app.get('/api/enhanced-professions-summary', requireAuth, async (req, res) => {
    try {
        const summary = await database.getEnhancedProfessionSummary(req.session.userId);
        res.json(summary);
    } catch (error) {
        console.error('Enhanced profession summary error:', error);
        res.status(500).json({ error: 'Failed to get enhanced profession summary' });
    }
});

// Get missing profession coverage
app.get('/api/missing-profession-coverage', requireAuth, async (req, res) => {
    try {
        const missingCoverage = await database.getMissingProfessionCoverage(req.session.userId);
        res.json(missingCoverage);
    } catch (error) {
        console.error('Missing profession coverage error:', error);
        res.status(500).json({ error: 'Failed to get missing profession coverage' });
    }
});

// Get character-specific profession data
app.get('/api/character-professions/:characterId', requireAuth, async (req, res) => {
    try {
        const professions = await database.getCharacterProfessions(req.session.userId, req.params.characterId);
        res.json(professions);
    } catch (error) {
        console.error('Character professions error:', error);
        res.status(500).json({ error: 'Failed to get character professions' });
    }
});

// Update user region
app.post('/api/user-region', requireAuth, async (req, res) => {
    try {
        const { region } = req.body;
        if (!['us', 'eu'].includes(region)) {
            return res.status(400).json({ error: 'Invalid region. Must be "us" or "eu".' });
        }
        
        await database.updateUserRegion(req.session.userId, region);
        res.json({ success: true, region });
    } catch (error) {
        console.error('Update region error:', error);
        res.status(500).json({ error: 'Failed to update region' });
    }
});

// Get user region
app.get('/api/user-region', requireAuth, async (req, res) => {
    try {
        const region = await database.getUserRegion(req.session.userId);
        res.json({ region });
    } catch (error) {
        console.error('Get region error:', error);
        res.status(500).json({ error: 'Failed to get region' });
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

// Recipe cache update endpoint - user-scoped
app.post('/api/update-recipe-cache', requireAuth, async (req, res) => {
    try {
        console.log(`Starting recipe cache update for user ${req.session.userId}...`);
        
        const userId = req.session.userId;
        const userRegion = await getUserRegionForAPI(userId);
        
        // Note: Recipe cache will be updated incrementally
        
        const results = {
            professionsUpdated: 0,
            tiersUpdated: 0,
            recipesAdded: 0,
            charactersUpdated: 0,
            errors: []
        };
        
        // Get all user's characters with professions
        const characters = await database.getAllCharacters(req.session.userId);
        
        for (const character of characters) {
            try {
                // Get character professions from API
                const professionsResponse = await axios.get(
                    `https://${userRegion}.api.blizzard.com/profile/wow/character/${character.realm.toLowerCase().replace(' ', '')}/${character.name.toLowerCase()}/professions?namespace=profile-${userRegion}`,
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
                        
                        results.professionsUpdated++;
                        
                        // Process each tier
                        if (prof.tiers) {
                            for (const tier of prof.tiers) {
                                const tierName = extractEnglishText(tier.tier);
                                const tierId = tier.tier?.id;
                                
                                if (tierId) {
                                    results.tiersUpdated++;
                                    
                                    // Get recipes for this profession tier from Game Data API
                                    try {
                                        const recipesResponse = await axios.get(
                                            `https://${userRegion}.api.blizzard.com/data/wow/profession/${professionId}/skill-tier/${tierId}?namespace=static-${userRegion}`,
                                            {
                                                headers: {
                                                    'Authorization': `Bearer ${await getClientCredentialsToken(userRegion)}`
                                                }
                                            }
                                        );
                                        
                                        // Cache the recipes from this tier
                                        if (recipesResponse.data.categories) {
                                            const tierData = {
                                                id: tierId,
                                                name: tierName,
                                                categories: recipesResponse.data.categories.map(cat => ({
                                                    name: extractEnglishText(cat),
                                                    recipes: cat.recipes ? cat.recipes.map(recipe => ({
                                                        id: recipe.id,
                                                        name: extractEnglishText(recipe)
                                                    })) : []
                                                }))
                                            };
                                            
                                            await database.cacheRecipes(professionId, professionName, tierData);
                                            
                                            // Count recipes added
                                            tierData.categories.forEach(cat => {
                                                results.recipesAdded += cat.recipes.length;
                                            });
                                        }
                                        
                                        // Store known recipes for this character
                                        const knownRecipeIds = tier.known_recipes ? tier.known_recipes.map(r => r.id) : [];
                                        if (knownRecipeIds.length > 0) {
                                            await database.upsertKnownRecipes(
                                                req.session.userId,
                                                character.id,
                                                professionId,
                                                tierId,
                                                knownRecipeIds
                                            );
                                        }
                                        
                                    } catch (recipeErr) {
                                        console.error(`Failed to get recipes for ${professionName} ${tierName}:`, recipeErr.message);
                                        results.errors.push(`${professionName} ${tierName}: ${recipeErr.message}`);
                                    }
                                }
                            }
                        }
                    }
                }
                
                results.charactersUpdated++;
                
            } catch (charErr) {
                console.error(`Failed to update recipes for ${character.name}:`, charErr.message);
                results.errors.push(`${character.name}: ${charErr.message}`);
            }
        }
        
        console.log('Recipe cache update completed:', results);
        res.json({
            success: true,
            message: 'Recipe cache updated successfully',
            results: results
        });
        
    } catch (error) {
        console.error('Recipe cache update error:', error);
        res.status(500).json({ 
            error: 'Failed to update recipe cache',
            details: error.message
        });
    }
});

// Recipe caching endpoint - admin/background job
app.post('/api/cache-recipes', async (req, res) => {
    try {
        console.log('Starting recipe cache update...');
        
        // Get all professions first
        const professionsResponse = await axios.get(
            `https://${process.env.REGION}.api.blizzard.com/data/wow/profession/?namespace=static-${process.env.REGION}`,
            {
                headers: {
                    'Authorization': `Bearer ${await getClientCredentialsToken()}`
                }
            }
        );
        
        let totalRecipesCached = 0;
        const processedProfessions = [];
        
        // Process each profession
        for (const profession of professionsResponse.data.professions) {
            // Skip non-primary professions (like Soul Cyphering, etc.)
            if ([2777, 2787, 2791, 2819, 2821, 2870, 2847, 2811, 2886].includes(profession.id)) {
                continue;
            }
            
            try {
                // Get profession details
                const professionResponse = await axios.get(
                    `https://${process.env.REGION}.api.blizzard.com/data/wow/profession/${profession.id}?namespace=static-${process.env.REGION}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${await getClientCredentialsToken()}`
                        }
                    }
                );
                
                // Process each skill tier for this profession
                for (const skillTier of professionResponse.data.skill_tiers) {
                    try {
                        // Get tier details with recipes
                        const tierResponse = await axios.get(
                            `https://${process.env.REGION}.api.blizzard.com/data/wow/profession/${profession.id}/skill-tier/${skillTier.id}?namespace=static-${process.env.REGION}`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${await getClientCredentialsToken()}`
                                }
                            }
                        );
                        
                        // Format tier data with extracted text for proper caching
                        const tierData = {
                            id: skillTier.id,
                            name: extractEnglishText(skillTier),
                            categories: tierResponse.data.categories || []
                        };
                        
                        // Cache the recipes
                        await database.cacheRecipes(profession.id, extractEnglishText(profession), tierData);
                        
                        const recipeCount = tierResponse.data.categories?.reduce(
                            (total, cat) => total + (cat.recipes?.length || 0), 0
                        ) || 0;
                        
                        totalRecipesCached += recipeCount;
                        console.log(`Cached ${recipeCount} recipes for ${profession.name} - ${skillTier.name}`);
                        
                        // Small delay to avoid hitting API limits
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (tierErr) {
                        console.error(`Failed to cache tier ${skillTier.name} for ${profession.name}:`, tierErr.message);
                    }
                }
                
                processedProfessions.push(profession.name);
                
            } catch (profErr) {
                console.error(`Failed to process profession ${profession.name}:`, profErr.message);
            }
        }
        
        console.log(`Recipe caching complete! Cached ${totalRecipesCached} recipes across ${processedProfessions.length} professions.`);
        
        res.json({
            success: true,
            totalRecipesCached,
            processedProfessions
        });
        
    } catch (error) {
        console.error('Recipe caching error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to cache recipes' });
    }
});

// Get missing recipes for a character's profession tier
app.get('/api/missing-recipes/:characterId/:professionId/:tierId', requireAuth, async (req, res) => {
    try {
        const { characterId, professionId, tierId } = req.params;
        
        // Get character's known recipes from their profession data
        const character = await database.getCharacterWithProfessions(req.session.userId, characterId);
        if (!character) {
            return res.status(404).json({ error: 'Character not found' });
        }
        
        // Find the specific profession tier
        const professionTier = character.professions.find(p => 
            p.profession_id == professionId && p.tier_id == tierId
        );
        
        if (!professionTier) {
            return res.status(404).json({ error: 'Profession tier not found for this character' });
        }
        
        // Get known recipe IDs for this character's profession tier
        const knownRecipeIds = await database.getKnownRecipeIds(characterId, professionId, tierId);
        
        // Get missing recipes (all cached recipes minus known ones)
        const missingRecipes = await database.getMissingRecipes(professionId, tierId, knownRecipeIds);
        
        // Group by category for better display
        const groupedRecipes = {};
        let totalMissing = 0;
        
        missingRecipes.forEach(recipe => {
            if (!groupedRecipes[recipe.category_name]) {
                groupedRecipes[recipe.category_name] = [];
            }
            groupedRecipes[recipe.category_name].push({
                id: recipe.recipe_id,
                name: recipe.recipe_name,
                wowheadUrl: `https://www.wowhead.com/recipe=${recipe.recipe_id}`
            });
            totalMissing++;
        });
        
        // Get total available recipes for completion percentage
        const allRecipes = await database.getMissingRecipes(professionId, tierId, []);
        const totalAvailable = allRecipes.length;
        const knownCount = knownRecipeIds.length;
        const completionPercentage = totalAvailable > 0 ? Math.round((knownCount / totalAvailable) * 100) : 0;
        
        res.json({
            professionName: professionTier.profession_name,
            tierName: professionTier.tier_name,
            knownRecipes: knownCount,
            totalRecipes: totalAvailable,
            missingRecipes: totalMissing,
            completionPercentage,
            categories: groupedRecipes
        });
        
    } catch (error) {
        console.error('Missing recipes error:', error);
        res.status(500).json({ error: 'Failed to get missing recipes' });
    }
});

// Get recipe cache status
app.get('/api/recipe-cache-status', async (req, res) => {
    try {
        const status = await database.getRecipeCacheStatus();
        res.json(status);
    } catch (error) {
        console.error('Recipe cache status error:', error);
        res.status(500).json({ error: 'Failed to get cache status' });
    }
});

// WoW Token price endpoint
app.get('/api/wow-token', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const userRegion = await getUserRegionForAPI(userId);
        
        // Cache token price for 30 minutes per region
        const cacheKey = `wow_token_price_${userRegion}`;
        
        // Check if we have cached data (simple in-memory cache for now)
        if (app.locals[cacheKey] && 
            app.locals[`${cacheKey}_time`] && 
            Date.now() - app.locals[`${cacheKey}_time`] < 30 * 60 * 1000) {
            return res.json(app.locals[cacheKey]);
        }
        
        const tokenResponse = await axios.get(
            `https://${userRegion}.api.blizzard.com/data/wow/token/?namespace=dynamic-${userRegion}`,
            {
                headers: {
                    'Authorization': `Bearer ${await getClientCredentialsToken(userRegion)}`
                }
            }
        );
        
        const tokenData = {
            price: tokenResponse.data.price,
            lastUpdated: tokenResponse.data.last_updated_timestamp
        };
        
        // Cache the result
        app.locals[cacheKey] = tokenData;
        app.locals[`${cacheKey}_time`] = Date.now();
        
        res.json(tokenData);
    } catch (error) {
        console.error('WoW Token API error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch WoW Token price' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err.stack);

    // Only send response if headers haven't been sent yet
    if (!res.headersSent) {
        res.status(500).json({ error: 'Something went wrong!' });
    }
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`✨ WoW Character Manager (PostgreSQL) running on http://localhost:${PORT}`);
    console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📁 Database: ${path.join(__dirname, 'data', 'wow_characters.db')}`);
    
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        console.warn('⚠️  WARNING: SESSION_SECRET is not set or too short. Set a strong secret in production!');
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(async () => {
        console.log('HTTP server closed');
        try {
            await database.pool.end();
            console.log('Database connection closed');
        } catch (err) {
            console.error('Error closing database:', err);
        }
        process.exit(0);
    });
});

module.exports = app;