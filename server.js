const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

// Import database module
const database = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'warcraft-is-life',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Initialize database on startup
database.initDatabase().then(() => {
    console.log('📊 Database initialized successfully');
}).catch(err => {
    console.error('Failed to initialize database:', err);
});

// OAuth endpoints
app.get('/auth/login', (req, res) => {
    const state = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    req.session.oauthState = state;
    
    const authUrl = `https://${process.env.REGION}.battle.net/oauth/authorize?` +
        `client_id=${process.env.BNET_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(process.env.BNET_REDIRECT_URI)}&` +
        `response_type=code&` +
        `scope=wow.profile&` +
        `state=${state}`;
    
    res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!state || state !== req.session.oauthState) {
        return res.redirect('/?error=invalid_state');
    }
    
    if (!code) {
        return res.redirect('/?error=no_code');
    }
    
    delete req.session.oauthState;
    
    try {
        const tokenResponse = await axios.post(
            `https://${process.env.REGION}.battle.net/oauth/token`,
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.BNET_REDIRECT_URI,
                client_id: process.env.BNET_CLIENT_ID,
                client_secret: process.env.BNET_CLIENT_SECRET
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );
        
        req.session.accessToken = tokenResponse.data.access_token;
        res.redirect('/');
    } catch (error) {
        console.error('OAuth error:', error.response?.data || error.message);
        res.redirect('/?error=auth_failed');
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// API endpoints
app.get('/api/characters', async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
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
        
        // Helper function to extract English text from Blizzard's localized objects
        function extractEnglishText(obj) {
            if (!obj) return 'Unknown';
            if (typeof obj === 'string') return obj;
            
            // For objects like {name: {en_US: "Horde", ...}}
            if (obj.name && typeof obj.name === 'object' && obj.name.en_US) {
                return obj.name.en_US;
            }
            
            // For objects like {en_US: "Horde", ...}
            if (obj.en_US) {
                return obj.en_US;
            }
            
            // Fallback
            if (obj.name && typeof obj.name === 'string') {
                return obj.name;
            }
            
            return 'Unknown';
        }
        
        for (const account of profileResponse.data.wow_accounts) {
            for (const char of account.characters) {
                if (char.level >= 70) {
                    try {
                        const charDetails = await axios.get(
                            `https://${process.env.REGION}.api.blizzard.com/profile/wow/character/${char.realm.slug}/${char.name.toLowerCase()}?namespace=profile-${process.env.REGION}`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${req.session.accessToken}`
                                }
                            }
                        );
                        
                        // Get profession data for this character
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
                            
                            // Extract primary professions with tier information
                            if (professionsResponse.data.primaries) {
                                professions = professionsResponse.data.primaries.map(prof => {
                                    const professionName = extractEnglishText(prof.profession);
                                    
                                    // Extract tier information (expansion-specific skills)
                                    const tiers = prof.tiers ? prof.tiers.map(tier => ({
                                        name: extractEnglishText(tier.tier),
                                        skillLevel: tier.skill_points || 0,
                                        maxSkill: tier.max_skill_points || 0,
                                        recipes: tier.known_recipes ? tier.known_recipes.length : 0
                                    })) : [];
                                    
                                    // Get the highest tier for display
                                    const currentTier = tiers.length > 0 ? tiers[0] : null;
                                    
                                    return {
                                        name: professionName,
                                        id: prof.profession.id,
                                        skillLevel: currentTier ? currentTier.skillLevel : 0,
                                        maxSkill: currentTier ? currentTier.maxSkill : 0,
                                        tiers: tiers,
                                        totalRecipes: tiers.reduce((sum, tier) => sum + tier.recipes, 0)
                                    };
                                });
                            }
                            
                            console.log(`${char.name} professions:`, professions.map(p => `${p.name} (${p.skillLevel}/${p.maxSkill})`).join(', '));
                        } catch (profErr) {
                            console.error(`Failed to get professions for ${char.name}:`, profErr.message);
                        }
                        
                        // Extract all the English values
                        const extractedFaction = extractEnglishText(charDetails.data.faction);
                        const extractedClass = extractEnglishText(charDetails.data.character_class);
                        const extractedRace = extractEnglishText(charDetails.data.race);
                        const extractedRealm = extractEnglishText(charDetails.data.realm);
                        
                        console.log(`Processing ${char.name}: faction="${extractedFaction}", class="${extractedClass}"`);
                        
                        const characterData = {
                            id: `${char.realm.slug}-${char.name.toLowerCase()}`,
                            name: char.name,
                            realm: extractedRealm,
                            level: charDetails.data.level,
                            class: extractedClass,
                            race: extractedRace,
                            faction: extractedFaction,
                            averageItemLevel: charDetails.data.average_item_level,
                            equippedItemLevel: charDetails.data.equipped_item_level,
                            professions: professions
                        };
                        
                        // Save to database
                        try {
                            await database.upsertCharacter(characterData);
                            
                            // Save professions to database
                            for (const prof of professions) {
                                await database.upsertProfession(characterData.id, prof);
                            }
                        } catch (dbErr) {
                            console.error(`Failed to save ${char.name} to database:`, dbErr);
                        }
                        
                        characters.push(characterData);
                    } catch (err) {
                        console.error(`Failed to get details for ${char.name}:`, err.message);
                        
                        // Fallback with basic info
                        const fallbackFaction = extractEnglishText(char.faction);
                        const fallbackClass = extractEnglishText(char.playable_class);
                        const fallbackRace = extractEnglishText(char.playable_race);
                        const fallbackRealm = extractEnglishText(char.realm);
                        
                        const characterData = {
                            id: `${char.realm.slug}-${char.name.toLowerCase()}`,
                            name: char.name,
                            realm: fallbackRealm,
                            level: char.level,
                            class: fallbackClass,
                            race: fallbackRace,
                            faction: fallbackFaction,
                            professions: []
                        };
                        
                        // Save to database even for fallback
                        try {
                            await database.upsertCharacter(characterData);
                        } catch (dbErr) {
                            console.error(`Failed to save ${char.name} to database:`, dbErr);
                        }
                        
                        characters.push(characterData);
                    }
                }
            }
        }
        
        console.log(`Sending ${characters.length} characters to client`);
        
        // Update the class/race/faction combinations in database
        try {
            await database.updateCombinations(characters);
            console.log('Updated class/race/faction combinations');
        } catch (dbErr) {
            console.error('Failed to update combinations:', dbErr);
        }
        
        // Sort by item level (highest first)
        characters.sort((a, b) => {
            const ilvlA = a.averageItemLevel || 0;
            const ilvlB = b.averageItemLevel || 0;
            return ilvlB - ilvlA;
        });
        
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

app.get('/api/auth/status', async (req, res) => {
    console.log('Auth status check - Token exists?', !!req.session.accessToken);
    
    if (!req.session.accessToken) {
        return res.json({ authenticated: false });
    }
    
    try {
        const testResponse = await axios.get(
            `https://${process.env.REGION}.api.blizzard.com/profile/user/wow?namespace=profile-${process.env.REGION}`,
            {
                headers: {
                    'Authorization': `Bearer ${req.session.accessToken}`
                }
            }
        );
        console.log('Token validation successful');
        res.json({ authenticated: true });
    } catch (error) {
        console.log('Token validation failed:', error.response?.status);
        req.session.destroy();
        res.json({ authenticated: false });
    }
});

// Notes endpoints (using database)
app.get('/api/notes/:characterId', async (req, res) => {
    try {
        const notes = await database.getNotes(req.params.characterId);
        res.json({ notes: notes || '' });
    } catch (error) {
        console.error('Failed to get notes:', error);
        res.json({ notes: '' });
    }
});

app.post('/api/notes/:characterId', async (req, res) => {
    try {
        await database.saveNotes(req.params.characterId, req.body.notes);
        res.json({ success: true });
    } catch (error) {
        console.error('Notes save error:', error);
        res.status(500).json({ error: 'Failed to save notes' });
    }
});

// API endpoint for profession summary
app.get('/api/professions-summary', async (req, res) => {
    if (!req.session.accessToken) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    
    try {
        const summary = await database.getProfessionSummary();
        res.json(summary);
    } catch (error) {
        console.error('Profession summary error:', error);
        res.status(500).json({ error: 'Failed to get profession summary' });
    }
});

// API endpoint for class/race/faction combinations
app.get('/api/combinations', async (req, res) => {
    try {
        const combinations = await database.getCombinationMatrix();
        res.json(combinations);
    } catch (error) {
        console.error('Combinations error:', error);
        res.status(500).json({ error: 'Failed to get combinations' });
    }
});

// API endpoint to get all characters from database (fast loading)
app.get('/api/characters-cached', async (req, res) => {
    try {
        const characters = await database.getAllCharacters();
        res.json(characters);
    } catch (error) {
        console.error('Failed to get cached characters:', error);
        res.status(500).json({ error: 'Failed to get characters from cache' });
    }
});

app.listen(PORT, () => {
    console.log(`✨ WoW Character Manager running on http://localhost:${PORT}`);
    console.log(`🔑 Make sure you've set up your .env file!`);
    console.log(`📁 Database will be created at: ${path.join(__dirname, 'data', 'wow_characters.db')}`);
});