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

// Helper function to generate Discord-friendly markdown
function generateDiscordMarkdown(version, release) {
    const typeEmojis = {
        feature: '🎉',
        fix: '🛠️',
        security: '🔒',
        performance: '⚡'
    };

    const emoji = typeEmojis[release.type] || '📝';

    let markdown = `${emoji} **Warband Tracker v${version}** - ${release.title}\n\n`;

    release.changes.forEach(change => {
        markdown += `• ${change}\n`;
    });

    markdown += `\n🔗 View full changelog: <https://warband-tracker.onrender.com/changelog>`;

    return markdown;
}

// Helper function to generate consistent character IDs
function generateCharacterId(realmName, characterName) {
    const realmSlug = realmName.toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/['']/g, '')
        .replace(/[^a-z0-9-]/g, '');
    return `${realmSlug}-${characterName.toLowerCase()}`;
}

// Helper function to migrate character IDs from old format to new format
async function migrateCharacterIds() {
    try {
        console.log('🔄 Checking for character ID migration needs...');

        // Get all characters that might have inconsistent IDs
        const client = await database.pool.connect();
        try {
            // Find characters where the ID doesn't match our expected format
            const result = await client.query(`
                SELECT id, name, realm, user_id
                FROM characters
                WHERE id NOT LIKE CONCAT(
                    LOWER(REPLACE(REPLACE(REPLACE(realm, ' ', '-'), '''', ''), '''', '')),
                    '-',
                    LOWER(name)
                )
                AND realm IS NOT NULL
            `);

            if (result.rows.length > 0) {
                console.log(`Found ${result.rows.length} characters needing ID migration`);

                for (const char of result.rows) {
                    const newId = generateCharacterId(char.realm, char.name);

                    if (char.id !== newId) {
                        console.log(`Migrating ${char.id} -> ${newId}`);

                        // Update the character record
                        await client.query(`
                            UPDATE characters
                            SET id = $1
                            WHERE id = $2 AND user_id = $3
                        `, [newId, char.id, char.user_id]);

                        // Update related tables
                        await client.query(`
                            UPDATE professions
                            SET character_id = $1
                            WHERE character_id = $2 AND user_id = $3
                        `, [newId, char.id, char.user_id]);

                        await client.query(`
                            UPDATE character_known_recipes
                            SET character_id = $1
                            WHERE character_id = $2 AND user_id = $3
                        `, [newId, char.id, char.user_id]);

                        await client.query(`
                            UPDATE character_notes
                            SET character_id = $1
                            WHERE character_id = $2 AND user_id = $3
                        `, [newId, char.id, char.user_id]);
                    }
                }

                console.log('✅ Character ID migration completed');
            } else {
                console.log('✅ No character ID migration needed');
            }
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ Character ID migration failed:', error);
    }
}

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
app.use('/changelog.js', express.static(path.join(__dirname, 'public', 'changelog.js')));
app.use('/admin.js', express.static(path.join(__dirname, 'public', 'admin.js')));
app.use('/profession-planning.css', express.static(path.join(__dirname, 'public', 'profession-planning.css')));
app.use('/profession-planning.js', express.static(path.join(__dirname, 'public', 'profession-planning.js')));

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

    // Check quest cache status and update if needed
    checkAndUpdateQuestCache();

    // Clean up expired sessions periodically
    setInterval(() => {
        database.cleanupSessions().catch(console.error);
    }, 3600000); // Every hour

    // Check recipe cache weekly
    setInterval(() => {
        checkAndUpdateRecipeCache();
    }, 7 * 24 * 60 * 60 * 1000); // Weekly

    // Check quest cache weekly
    setInterval(() => {
        checkAndUpdateQuestCache();
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
                        console.error(`Failed to cache tier ${extractEnglishText(skillTier)}:`, tierErr.message);
                    }
                }
            } catch (profErr) {
                console.error(`Failed to process profession ${extractEnglishText(profession)}:`, profErr.message);
            }
        }
        
        console.log(`Background recipe cache complete! Cached ${totalRecipesCached} recipes.`);
        
    } catch (error) {
        console.error('Background recipe caching error:', error.message);
    }
}

// Auction House Data Collection Service
async function updateAuctionHouseData(connectedRealmId, region = 'us') {
    try {

        const token = await getClientCredentialsToken(region);
        const startTime = Date.now();

        const response = await axios.get(
            `https://${region}.api.blizzard.com/data/wow/connected-realm/${connectedRealmId}/auctions?namespace=dynamic-${region}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                timeout: 45000 // 45 second timeout
            }
        );

        if (response.data && response.data.auctions) {
            const result = await database.upsertAuctionData(connectedRealmId, response.data.auctions, region);
            return result;
        } else {
            console.log(`⚠️ No auction data returned for realm ${connectedRealmId}`);
            return null;
        }
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            console.error(`⏱️ Timeout: Auction house API took longer than 45 seconds for realm ${connectedRealmId}`);
            throw new Error(`Auction house API timeout (45s) for realm ${connectedRealmId}`);
        } else if (error.response?.status === 503) {
            console.error(`🚫 Service unavailable: Auction house API is down for realm ${connectedRealmId}`);
            throw new Error(`Auction house API unavailable for realm ${connectedRealmId}`);
        } else if (error.response?.status === 429) {
            console.error(`⏸️ Rate limited: Too many requests to auction house API for realm ${connectedRealmId}`);
            throw new Error(`Rate limited by auction house API for realm ${connectedRealmId}`);
        } else {
            console.error(`❌ Failed to update auction house data for realm ${connectedRealmId}:`, error.message);
            throw error;
        }
    }
}

// Regional Commodities Auction House Data Collection
async function updateRegionalCommodities(region = 'us') {
    try {
        console.log(`📦 Fetching regional commodities data for ${region.toUpperCase()}...`);

        const token = await getClientCredentialsToken(region);
        const startTime = Date.now();

        const response = await axios.get(
            `https://${region}.api.blizzard.com/data/wow/auctions/commodities?namespace=dynamic-${region}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                timeout: 45000 // 45 second timeout
            }
        );

        const fetchTime = Date.now() - startTime;
        console.log(`⏱️ Commodities API fetch completed in ${fetchTime}ms for ${region.toUpperCase()}`);

        if (response.data && response.data.auctions) {
            // Use a special connected_realm_id of 0 for commodities (region-wide)
            const result = await database.upsertAuctionData(0, response.data.auctions, region);
            console.log(`✅ Updated commodities data for ${region.toUpperCase()}: ${result.itemsProcessed} items, ${result.auctionsProcessed} auctions`);
            return result;
        } else {
            console.log(`⚠️ No commodities data returned for ${region.toUpperCase()}`);
            return null;
        }
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            console.error(`⏱️ Timeout: Commodities API took longer than 45 seconds for ${region}`);
            throw new Error(`Commodities API timeout (45s) for ${region}`);
        } else if (error.response?.status === 503) {
            console.error(`🚫 Service unavailable: Commodities API is down for ${region}`);
            throw new Error(`Commodities API unavailable for ${region}`);
        } else if (error.response?.status === 429) {
            console.error(`⏸️ Rate limited: Too many requests to commodities API for ${region}`);
            throw new Error(`Rate limited by commodities API for ${region}`);
        } else {
            console.error(`❌ Failed to update commodities data for ${region}:`, error.message);
            throw error;
        }
    }
}

// Get connected realm ID for a character's realm
async function getConnectedRealmId(realmSlug, region = 'us') {
    try {
        // First check our local database cache
        const cachedId = await database.findConnectedRealmId(realmSlug, region);
        if (cachedId) {
            console.log(`✅ Found cached connected realm ID ${cachedId} for ${realmSlug} (${region})`);
            return cachedId;
        }

        // Convert realm name to proper slug format
        const properSlug = realmSlug.toLowerCase()
            .replace(/'/g, '')
            .replace(/[\s-]+/g, '-')
            .replace(/[^a-z0-9-]/g, '');

        const token = await getClientCredentialsToken(region);

        // Try the converted slug first
        let realmResponse;
        try {
            realmResponse = await axios.get(
                `https://${region}.api.blizzard.com/data/wow/realm/${properSlug}?namespace=dynamic-${region}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );
        } catch (error) {
            if (error.response?.status === 404) {
                // If that fails, try the original slug
                console.log(`⚠️ Realm slug '${properSlug}' not found, trying original '${realmSlug}'`);
                realmResponse = await axios.get(
                    `https://${region}.api.blizzard.com/data/wow/realm/${realmSlug}?namespace=dynamic-${region}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    }
                );
            } else {
                throw error;
            }
        }

        if (realmResponse.data && realmResponse.data.connected_realm) {
            // Extract connected realm ID from URL
            const connectedRealmUrl = realmResponse.data.connected_realm.href;
            const match = connectedRealmUrl.match(/connected-realm\/(\d+)/);
            if (match) {
                const connectedRealmId = parseInt(match[1]);

                // Cache this result for future use
                try {
                    await database.updateConnectedRealmMapping(connectedRealmId, {
                        realms: [{
                            slug: realmSlug,
                            name: realmResponse.data.name || realmSlug
                        }]
                    }, region);
                } catch (cacheError) {
                    console.warn(`⚠️ Failed to cache realm mapping: ${cacheError.message}`);
                }

                console.log(`✅ Found connected realm ID ${connectedRealmId} for ${realmSlug} (${region})`);
                return connectedRealmId;
            }
        }

        throw new Error(`Could not find connected realm ID for ${realmSlug}`);
    } catch (error) {
        console.error(`❌ Failed to get connected realm ID for ${realmSlug} (${region}):`, error.message);

        // Provide helpful suggestions for common issues
        if (error.response?.status === 404) {
            console.error(`💡 Suggestion: Realm '${realmSlug}' not found. Check if realm name is correct or run 'Update Connected Realms' in admin panel.`);
        }

        throw error;
    }
}

// Background auction house update service
async function startAuctionHouseService() {
    // This will be triggered based on user characters' realms
    // For now, we'll implement on-demand updating when users request profession data
    console.log('🏪 Auction House service initialized (on-demand mode)');
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
    if (!obj) return null; // Changed from 'Unknown' to null for better handling
    if (typeof obj === 'string') return obj;

    // Handle direct localized objects like {"en_US": "Ashenvale", "es_MX": "Vallefresno", ...}
    if (typeof obj === 'object' && obj.en_US) {
        return obj.en_US;
    }

    // Handle nested name objects
    if (obj.name && typeof obj.name === 'object' && obj.name.en_US) {
        return obj.name.en_US;
    }
    if (obj.name && typeof obj.name === 'string') return obj.name;

    return null; // Changed from 'Unknown' to null
}

// Function to check and update quest cache
async function checkAndUpdateQuestCache() {
    try {
        const cacheStatus = await database.getQuestCacheStatus();
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        if (!cacheStatus.last_cached || new Date(cacheStatus.last_cached) < oneWeekAgo) {
            console.log('Quest cache is outdated or empty. Starting background update...');
            await updateQuestCacheFromCompletedQuests();
        } else {
            console.log(`Quest cache is current. ${cacheStatus.total_quests} quests cached.`);
        }
    } catch (error) {
        console.error('Failed to check quest cache status:', error);
    }
}

// Background quest cache update function
async function updateQuestCacheFromCompletedQuests() {
    try {
        console.log('Starting quest cache update from completed quests...');

        // Get all unique quest IDs from completed quests
        const client = await database.pool.connect();
        let uniqueQuestIds;
        try {
            uniqueQuestIds = await client.query(`
                SELECT DISTINCT quest_id
                FROM warband_completed_quests
                WHERE quest_id NOT IN (SELECT quest_id FROM cached_quests)
                ORDER BY quest_id
            `);
        } finally {
            client.release();
        }

        if (uniqueQuestIds.rows.length === 0) {
            console.log('No new quest IDs to cache');
            return;
        }

        console.log(`Found ${uniqueQuestIds.rows.length} quest IDs to cache`);

        let totalQuestsCached = 0;
        const accessToken = await getClientCredentialsToken();

        // Process quests in batches to respect rate limits
        const batchSize = 50; // Conservative batch size
        const questIds = uniqueQuestIds.rows.map(row => row.quest_id);

        for (let i = 0; i < questIds.length; i += batchSize) {
            const batch = questIds.slice(i, i + batchSize);

            for (const questId of batch) {
                try {
                    const questDetails = await fetchQuestDetails('us', questId, accessToken);

                    if (questDetails) {
                        // Extract zone and expansion info (with fallbacks)
                        const zoneName = extractEnglishText(questDetails.area) || 'Unknown Zone';
                        const expansionName = determineExpansionFromQuest(questDetails);
                        const category = questDetails.category ? extractEnglishText(questDetails.category) : null;
                        const isSeasonal = questDetails.id > 60000; // Rough heuristic for seasonal quests

                        await database.cacheQuest(
                            questDetails.id,
                            extractEnglishText(questDetails),
                            zoneName,
                            expansionName,
                            category,
                            isSeasonal
                        );

                        totalQuestsCached++;
                    }

                    // Rate limiting - 50ms delay between requests (20 requests/second)
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (questError) {
                    // Skip quest if API call fails (known issue with Battle.net API)
                    // console.log(`Skipped quest ${questId}: ${questError.message}`);
                }
            }

            console.log(`Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(questIds.length/batchSize)}`);
        }

        console.log(`Quest cache update complete! Cached ${totalQuestsCached} new quests.`);

        // Update zone summaries for all users if new quests were cached
        if (totalQuestsCached > 0) {
            await updateAllUserZoneSummaries();
        }
    } catch (error) {
        console.error('Failed to update quest cache:', error);
    }
}

// Helper function to determine expansion from quest data
function determineExpansionFromQuest(questDetails) {
    // This is a simplified mapping - in reality you'd need more sophisticated logic
    const questId = questDetails.id;

    if (questId >= 80000) return 'The War Within';
    if (questId >= 70000) return 'Dragonflight';
    if (questId >= 60000) return 'Shadowlands';
    if (questId >= 50000) return 'Battle for Azeroth';
    if (questId >= 40000) return 'Legion';
    if (questId >= 30000) return 'Warlords of Draenor';
    if (questId >= 25000) return 'Mists of Pandaria';
    if (questId >= 20000) return 'Cataclysm';
    if (questId >= 10000) return 'Wrath of the Lich King';
    if (questId >= 5000) return 'The Burning Crusade';

    return 'Classic';
}

// Helper function to update zone summaries for all users
async function updateAllUserZoneSummaries() {
    try {
        console.log('Updating zone summaries for all users...');

        const client = await database.pool.connect();
        let userIds;
        try {
            // Get all user IDs that have completed quests
            userIds = await client.query('SELECT DISTINCT user_id FROM warband_completed_quests');
        } finally {
            client.release();
        }

        for (const userRow of userIds.rows) {
            try {
                await database.updateZoneQuestSummary(userRow.user_id);
                console.log(`Updated zone summary for user ${userRow.user_id}`);
            } catch (userError) {
                console.error(`Failed to update zone summary for user ${userRow.user_id}:`, userError.message);
            }
        }

        console.log(`Zone summary update complete for ${userIds.rows.length} users`);
    } catch (error) {
        console.error('Failed to update zone summaries for all users:', error);
    }
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

// Helper function to fetch character completed quests
async function fetchCharacterCompletedQuests(region, realmSlug, characterName, accessToken) {
    try {
        const response = await axios.get(
            `https://${region}.api.blizzard.com/profile/wow/character/${realmSlug}/${characterName.toLowerCase()}/quests/completed?namespace=profile-${region}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );

        return response.data.quests || [];
    } catch (error) {
        console.error(`Failed to fetch quests for ${characterName}:`, error.message);
        return [];
    }
}

// Quest API fetcher functions for building comprehensive quest database
async function fetchQuestIndex(region, accessToken) {
    try {
        console.log(`Fetching quest index from: https://${region}.api.blizzard.com/data/wow/quest/index?namespace=static-${region}`);
        const response = await axios.get(
            `https://${region}.api.blizzard.com/data/wow/quest/index?namespace=static-${region}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );
        console.log('Quest index response structure:', {
            status: response.status,
            dataKeys: Object.keys(response.data),
            dataPreview: JSON.stringify(response.data, null, 2).substring(0, 500)
        });
        return response.data.quests || [];
    } catch (error) {
        console.error('Failed to fetch quest index:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data
        });
        return [];
    }
}

async function fetchQuestAreasIndex(region, accessToken) {
    try {
        console.log(`Fetching quest areas from: https://${region}.api.blizzard.com/data/wow/quest/area/index?namespace=static-${region}`);
        const response = await axios.get(
            `https://${region}.api.blizzard.com/data/wow/quest/area/index?namespace=static-${region}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );
        console.log('Quest areas response:', {
            status: response.status,
            dataKeys: Object.keys(response.data),
            count: response.data.quest_areas?.length || 0
        });
        return response.data.quest_areas || [];
    } catch (error) {
        console.error('Failed to fetch quest areas index:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        return [];
    }
}

async function fetchQuestCategoriesIndex(region, accessToken) {
    try {
        const response = await axios.get(
            `https://${region}.api.blizzard.com/data/wow/quest/category/index?namespace=static-${region}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );
        return response.data.quest_categories || [];
    } catch (error) {
        console.error('Failed to fetch quest categories index:', error.message);
        return [];
    }
}

async function fetchQuestTypesIndex(region, accessToken) {
    try {
        const response = await axios.get(
            `https://${region}.api.blizzard.com/data/wow/quest/type/index?namespace=static-${region}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );
        return response.data.quest_types || [];
    } catch (error) {
        console.error('Failed to fetch quest types index:', error.message);
        return [];
    }
}

async function fetchQuestDetails(region, questId, accessToken) {
    try {
        const response = await axios.get(
            `https://${region}.api.blizzard.com/data/wow/quest/${questId}?namespace=static-${region}`,
            {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }
        );
        return response.data;
    } catch (error) {
        return null; // Quest not found in static data
    }
}

// WowHead quest scraping functions
async function fetchWowHeadQuestsByZone(zoneName) {
    try {
        // WowHead has a search API that we can use
        const searchUrl = `https://www.wowhead.com/quests?filter=22:1;6:${encodeURIComponent(zoneName)};0:0`;

        console.log(`Scraping WowHead quests for zone: ${zoneName}`);

        // This would need to be implemented with web scraping
        // For now, let's return empty array and implement step by step
        return [];
    } catch (error) {
        console.error(`Failed to scrape WowHead for zone ${zoneName}:`, error.message);
        return [];
    }
}

async function fetchWowHeadQuestData(questId) {
    try {
        // WowHead quest tooltip API (unofficial)
        const response = await axios.get(`https://www.wowhead.com/tooltip/quest/${questId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // Parse the tooltip response to extract quest data
        // This needs to be implemented based on WowHead's response format
        return null;
    } catch (error) {
        console.error(`Failed to get WowHead data for quest ${questId}:`, error.message);
        return null;
    }
}

// Known WoW zones for comprehensive quest scraping
const WOW_ZONES = [
    // Classic zones
    'Elwynn Forest', 'Westfall', 'Redridge Mountains', 'Duskwood', 'Stranglethorn Vale',
    'Dun Morogh', 'Loch Modan', 'Wetlands', 'Arathi Highlands', 'Badlands',
    'Teldrassil', 'Darkshore', 'Ashenvale', 'Stonetalon Mountains', 'Desolace',
    'Durotar', 'The Barrens', 'Stonetalon Mountains', 'Thousand Needles', 'Tanaris',

    // Burning Crusade
    'Hellfire Peninsula', 'Zangarmarsh', 'Nagrand', 'Blade\'s Edge Mountains', 'Netherstorm',
    'Terokkar Forest', 'Shadowmoon Valley',

    // Wrath of the Lich King
    'Borean Tundra', 'Dragonblight', 'Grizzly Hills', 'Howling Fjord', 'Icecrown',
    'Sholazar Basin', 'The Storm Peaks', 'Wintergrasp', 'Zul\'Drak',

    // Cataclysm
    'Mount Hyjal', 'Vashj\'ir', 'Deepholm', 'Uldum', 'Twilight Highlands',

    // Mists of Pandaria
    'The Jade Forest', 'Valley of the Four Winds', 'Krasarang Wilds', 'Kun-Lai Summit',
    'Townlong Steppes', 'Dread Wastes', 'Vale of Eternal Blossoms',

    // Warlords of Draenor
    'Frostfire Ridge', 'Gorgrond', 'Talador', 'Spires of Arak', 'Nagrand (Draenor)',
    'Shadowmoon Valley (Draenor)',

    // Legion
    'Azsuna', 'Val\'sharah', 'Highmountain', 'Stormheim', 'Suramar',

    // Battle for Azeroth
    'Tiragarde Sound', 'Drustvar', 'Stormsong Valley', 'Zuldazar', 'Nazmir', 'Vol\'dun',

    // Shadowlands
    'Bastion', 'Maldraxxus', 'Ardenweald', 'Revendreth', 'The Maw',

    // Dragonflight
    'The Waking Shores', 'Ohn\'ahran Plains', 'The Azure Span', 'Thaldraszus',

    // The War Within
    'Isle of Dorn', 'The Ringing Deeps', 'Hallowfall', 'Azj-Kahet'
];


// Track quest discovery progress to avoid re-scanning same IDs
let questDiscoveryOffset = 0;

// Background Job Queue System
class QuestCacheJobQueue {
    constructor() {
        this.jobs = new Map(); // jobId -> job data
        this.queue = []; // Array of pending job IDs
        this.isProcessing = false;
        this.rateLimiter = new RateLimiter();
    }

    // Add a new job to the queue
    addJob(userId, userRegion, accessToken, battlenetTag) {
        const jobId = `quest-cache-${userId}-${Date.now()}`;
        const job = {
            id: jobId,
            userId,
            userRegion,
            accessToken,
            battlenetTag,
            status: 'queued',
            queuePosition: this.queue.length + 1,
            startTime: null,
            endTime: null,
            progress: {
                phase: 'queued',
                charactersProcessed: 0,
                totalCharacters: 0,
                questsProcessed: 0,
                questsContributed: 0,
                errors: []
            },
            createdAt: new Date(),
            error: null
        };

        this.jobs.set(jobId, job);
        this.queue.push(jobId);

        // Update queue positions for all jobs
        this.updateQueuePositions();

        console.log(`🔄 Added quest cache job ${jobId} for ${battlenetTag} (position ${job.queuePosition})`);

        // Start processing if not already running
        if (!this.isProcessing) {
            this.processQueue();
        }

        return jobId;
    }

    // Update queue positions for all pending jobs
    updateQueuePositions() {
        this.queue.forEach((jobId, index) => {
            const job = this.jobs.get(jobId);
            if (job && job.status === 'queued') {
                job.queuePosition = index + 1;
            }
        });
    }

    // Get job status
    getJobStatus(jobId) {
        return this.jobs.get(jobId) || null;
    }

    // Process the job queue
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        console.log(`🚀 Starting job queue processing. ${this.queue.length} jobs pending.`);

        while (this.queue.length > 0) {
            const jobId = this.queue.shift();
            const job = this.jobs.get(jobId);

            if (!job) continue;

            try {
                job.status = 'processing';
                job.startTime = new Date();
                job.progress.phase = 'starting';
                this.updateQueuePositions();

                console.log(`⚡ Processing job ${jobId} for ${job.battlenetTag}`);

                await this.executeQuestCacheJob(job);

                job.status = 'completed';
                job.endTime = new Date();
                job.progress.phase = 'completed';

                console.log(`✅ Completed job ${jobId} for ${job.battlenetTag} in ${job.endTime - job.startTime}ms`);

            } catch (error) {
                job.status = 'failed';
                job.endTime = new Date();
                job.error = error.message;
                job.progress.phase = 'failed';

                console.error(`❌ Job ${jobId} failed:`, error.message);
            }

            // Small delay between jobs to prevent overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        this.isProcessing = false;
        console.log(`🏁 Job queue processing complete`);
    }

    // Execute a single quest cache job
    async executeQuestCacheJob(job) {
        const { userId, userRegion, accessToken } = job;

        // Get user's characters
        const characters = await database.getAllCharacters(userId);
        job.progress.totalCharacters = characters.length;
        job.progress.phase = 'fetching_characters';

        if (characters.length === 0) {
            throw new Error('No characters found. Please refresh character data first.');
        }

        let questsProcessed = 0;
        let questsContributed = 0;
        const seenQuests = new Set();

        job.progress.phase = 'processing_characters';

        // Process characters with optimized performance
        for (let i = 0; i < characters.length; i++) {
            const character = characters[i];

            try {
                // Smart rate limiting - adaptive delays
                if (i > 0) {
                    await this.rateLimiter.waitForSlot();
                }

                // Convert realm name to proper format
                const realmSlug = character.realm.toLowerCase().replace(/\s+/g, '-').replace(/['']/g, '').replace(/[^a-z0-9-]/g, '');

                const completedQuests = await this.fetchCharacterQuestsWithRetry(
                    userRegion,
                    realmSlug,
                    character.name,
                    accessToken
                );

                console.log(`${character.name}: Found ${completedQuests.length} completed quests`);

                // Process completed quests in batches for better performance
                const batchSize = 10;
                for (let j = 0; j < completedQuests.length; j += batchSize) {
                    const batch = completedQuests.slice(j, j + batchSize);

                    await Promise.all(batch.map(async (questRef) => {
                        if (!seenQuests.has(questRef.id)) {
                            seenQuests.add(questRef.id);
                            await database.upsertCompletedQuest(userId, questRef.id);

                            // Add to master database if not already there
                            const existingQuest = await database.getQuestFromMaster(questRef.id);
                            if (!existingQuest) {
                                const questDetails = await this.fetchQuestDetailsWithRetry(userRegion, questRef.id, accessToken);
                                if (questDetails) {
                                    const questData = {
                                        quest_id: questDetails.id,
                                        quest_name: extractEnglishText(questDetails.name) || `Quest ${questDetails.id}`,
                                        area_id: questDetails.area?.id || null,
                                        area_name: extractEnglishText(questDetails.area?.name) || null,
                                        category_id: questDetails.category?.id || null,
                                        category_name: extractEnglishText(questDetails.category?.name) || null,
                                        type_id: questDetails.type?.id || null,
                                        type_name: extractEnglishText(questDetails.type?.name) || null,
                                        expansion_name: determineExpansionFromQuest(questDetails) || 'Unknown',
                                        is_seasonal: questDetails.id > 60000
                                    };
                                    await database.upsertQuestMaster(questData);
                                    questsContributed++;
                                }
                            }
                            questsProcessed++;
                        }
                    }));

                    // Update progress
                    job.progress.questsProcessed = questsProcessed;
                    job.progress.questsContributed = questsContributed;
                }

                job.progress.charactersProcessed = i + 1;

            } catch (charErr) {
                console.error(`Failed to process ${character.name}:`, charErr.message);
                job.progress.errors.push(`${character.name}: ${charErr.message}`);
            }
        }

        // Update quest zone summaries
        job.progress.phase = 'updating_summaries';
        try {
            await database.updateZoneQuestSummary(userId);
            await database.updateQuestSyncTime(userId);
        } catch (summaryErr) {
            console.error('Failed to update quest zone summaries:', summaryErr.message);
            job.progress.errors.push(`Zone summary update: ${summaryErr.message}`);
        }

        // Trigger background quest discovery
        job.progress.phase = 'triggering_discovery';
        setImmediate(() => {
            backgroundQuestDiscovery(userRegion, accessToken)
                .catch(error => console.error('Background quest discovery error:', error));
        });

        job.progress.phase = 'completed';
    }

    // Fetch character quests with exponential backoff retry
    async fetchCharacterQuestsWithRetry(region, realmSlug, characterName, accessToken, maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.rateLimiter.waitForSlot();
                return await fetchCharacterCompletedQuests(region, realmSlug, characterName, accessToken);
            } catch (error) {
                if (error.response?.status === 429 && attempt < maxRetries - 1) {
                    // Rate limited - exponential backoff
                    const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                    console.log(`Rate limited, retrying ${characterName} in ${delay}ms (attempt ${attempt + 1})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    this.rateLimiter.recordError();
                } else {
                    throw error;
                }
            }
        }
        return [];
    }

    // Fetch quest details with retry logic
    async fetchQuestDetailsWithRetry(region, questId, accessToken, maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await this.rateLimiter.waitForSlot();
                return await fetchQuestDetails(region, questId, accessToken);
            } catch (error) {
                if (error.response?.status === 429 && attempt < maxRetries - 1) {
                    const delay = Math.pow(2, attempt) * 500 + Math.random() * 500;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    this.rateLimiter.recordError();
                } else {
                    return null; // Quest not found is normal
                }
            }
        }
        return null;
    }
}

// Smart rate limiter with adaptive throttling
class RateLimiter {
    constructor() {
        this.requestsPerSecond = 50; // Start conservative, can adapt up
        this.maxRequestsPerSecond = 80; // Leave some headroom under 100
        this.minRequestsPerSecond = 10;
        this.lastRequests = [];
        this.consecutiveErrors = 0;
    }

    async waitForSlot() {
        const now = Date.now();

        // Remove requests older than 1 second
        this.lastRequests = this.lastRequests.filter(time => now - time < 1000);

        // If we're at the limit, wait
        if (this.lastRequests.length >= this.requestsPerSecond) {
            const oldestRequest = Math.min(...this.lastRequests);
            const waitTime = 1000 - (now - oldestRequest) + 10; // Small buffer
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }

        this.lastRequests.push(now);
    }

    recordError() {
        this.consecutiveErrors++;
        // Reduce rate limit on consecutive errors
        if (this.consecutiveErrors >= 3) {
            this.requestsPerSecond = Math.max(
                this.minRequestsPerSecond,
                Math.floor(this.requestsPerSecond * 0.5)
            );
            console.log(`⚠️  Reduced rate limit to ${this.requestsPerSecond}/sec due to errors`);
        }
    }

    recordSuccess() {
        if (this.consecutiveErrors > 0) {
            this.consecutiveErrors = 0;
            // Gradually increase rate limit after successful runs
            this.requestsPerSecond = Math.min(
                this.maxRequestsPerSecond,
                Math.floor(this.requestsPerSecond * 1.1)
            );
        }
    }
}

// Global job queue instance
const questCacheJobQueue = new QuestCacheJobQueue();

// Background quest discovery service
async function backgroundQuestDiscovery(region, accessToken, maxQuests = 20000) {
    console.log('🔍 Starting background quest discovery...');

    const questRanges = [
        { start: 1, end: 15000, name: 'Classic', sample: 200 },
        { start: 9000, end: 12000, name: 'Burning Crusade', sample: 160 },
        { start: 11000, end: 14500, name: 'Wrath of the Lich King', sample: 170 },
        { start: 14000, end: 29000, name: 'Cataclysm', sample: 250 },
        { start: 28000, end: 35000, name: 'Mists of Pandaria', sample: 170 },
        { start: 33000, end: 40000, name: 'Warlords of Draenor', sample: 170 },
        { start: 38000, end: 48000, name: 'Legion', sample: 200 },
        { start: 46000, end: 58000, name: 'Battle for Azeroth', sample: 220 },
        { start: 57000, end: 66000, name: 'Shadowlands', sample: 190 },
        { start: 65000, end: 82000, name: 'Dragonflight', sample: 250 },
        { start: 80000, end: 95000, name: 'The War Within', sample: 250 },
        // Future-proofing: Adaptive high-range scanning
        { start: 93000, end: 120000, name: 'Future Content', sample: 200 }
    ];

    let totalProcessed = 0;
    let totalFound = 0;

    // Increment offset each run so we scan different quest IDs
    questDiscoveryOffset = (questDiscoveryOffset + 1) % 50; // Cycles 0-49

    try {
        for (const range of questRanges) {
            if (totalFound >= maxQuests) break;

            console.log(`🔎 Discovering ${range.name} quests (offset: ${questDiscoveryOffset})...`);
            let foundInRange = 0;
            const stepSize = Math.ceil((range.end - range.start) / range.sample);

            // Start with offset to scan different IDs each time
            for (let questId = range.start + questDiscoveryOffset; questId < range.end && foundInRange < range.sample; questId += stepSize) {
                try {
                    // Check if we already have this quest
                    const existingQuest = await database.getQuestFromMaster(questId);
                    if (existingQuest) {
                        continue; // Skip quests we already have
                    }

                    const questDetails = await fetchQuestDetails(region, questId, accessToken);

                    if (questDetails) {
                        const questData = {
                            quest_id: questDetails.id,
                            quest_name: extractEnglishText(questDetails.name) || `Quest ${questDetails.id}`,
                            area_id: questDetails.area?.id || null,
                            area_name: extractEnglishText(questDetails.area?.name) || null,
                            category_id: questDetails.category?.id || null,
                            category_name: extractEnglishText(questDetails.category?.name) || null,
                            type_id: questDetails.type?.id || null,
                            type_name: extractEnglishText(questDetails.type?.name) || null,
                            expansion_name: range.name,
                            is_seasonal: questDetails.id > 60000
                        };

                        await database.upsertQuestMaster(questData);
                        foundInRange++;
                        totalFound++;

                        if (totalFound % 50 === 0) {
                            console.log(`🎯 Background discovery: ${totalFound} quests found so far...`);
                        }
                    }

                    totalProcessed++;

                    // Gentle rate limiting for background operation
                    await new Promise(resolve => setTimeout(resolve, 150));

                } catch (questErr) {
                    // Silently continue - many quest IDs won't exist
                }

                // Break if we've found enough from this range
                if (totalFound >= maxQuests) break;
            }

            console.log(`✅ ${range.name}: Found ${foundInRange} new quests`);

            // Longer pause between expansion ranges
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`🎉 Background quest discovery complete! Found ${totalFound} new quests (processed ${totalProcessed} IDs)`);
        console.log(`🔄 Next run will use offset ${(questDiscoveryOffset + 1) % 50} to discover different quest IDs`);

    } catch (error) {
        console.error('❌ Background quest discovery error:', error);
    }
}

// Periodic quest discovery service (runs every 2 hours)
let questDiscoveryInterval = null;

async function startPeriodicQuestDiscovery() {
    // Don't start if already running
    if (questDiscoveryInterval) return;

    // console.log('🚀 Starting periodic quest discovery service...');

    const runDiscovery = async () => {
        try {
            // Get a client credentials token for the discovery
            const accessToken = await getClientCredentialsToken('us'); // Default to US region

            // Run background discovery with smaller batches for periodic runs
            await backgroundQuestDiscovery('us', accessToken, 500);

            console.log('⏰ Next quest discovery in 2 hours...');
        } catch (error) {
            console.error('❌ Periodic quest discovery error:', error);
        }
    };

    // Run immediately on startup (after a short delay)
    setTimeout(runDiscovery, 900000); // 60 second delay after server start

    // Then run every 2 hours
    questDiscoveryInterval = setInterval(runDiscovery, 2 * 60 * 60 * 1000);
}

function stopPeriodicQuestDiscovery() {
    if (questDiscoveryInterval) {
        clearInterval(questDiscoveryInterval);
        questDiscoveryInterval = null;
        console.log('🛑 Stopped periodic quest discovery service');
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

// Changelog page route
app.get('/changelog', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'changelog.html'));
});

// Admin panel route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Features page route
app.get('/features', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'features.html'));
});

// Profession Planning page route
app.get('/profession-planning', requireAuthRedirect, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profession-planning.html'));
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

// Reusable function to refresh character data for a user
async function refreshUserCharacterData(userId, accessToken, userRegion, forceQuestSync = false) {
    const profileResponse = await axios.get(
        `https://${userRegion}.api.blizzard.com/profile/user/wow?namespace=profile-${userRegion}`,
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        }
    );

    const characters = [];

    for (const account of profileResponse.data.wow_accounts) {
        for (const char of account.characters) {
            if (char.level >= 10) {
                try {
                    // Get character details - use consistent realm slug conversion
                    const realmSlug = extractEnglishText(char.realm).toLowerCase()
                        .replace(/\s+/g, '-')
                        .replace(/['']/g, '')
                        .replace(/[^a-z0-9-]/g, '');
                    const charDetails = await axios.get(
                        `https://${userRegion}.api.blizzard.com/profile/wow/character/${realmSlug}/${char.name.toLowerCase()}?namespace=profile-${userRegion}`,
                        {
                            headers: {
                                'Authorization': `Bearer ${accessToken}`
                            }
                        }
                    );

                    // Get character titles
                    let titleData = null;
                    try {
                        const titlesResponse = await axios.get(
                            `https://${userRegion}.api.blizzard.com/profile/wow/character/${realmSlug}/${char.name.toLowerCase()}/titles?namespace=profile-${userRegion}`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`
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

                    // Create basic character data first (without professions)
                    const characterData = {
                        id: generateCharacterId(extractEnglishText(char.realm), char.name),
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
                        professions: [] // Will be populated below
                    };

                    // Save character to database FIRST so it exists for foreign key references
                    await database.upsertCharacter(userId, characterData);

                    // Get professions
                    let professions = [];
                    try {
                        const professionsResponse = await axios.get(
                            `https://${userRegion}.api.blizzard.com/profile/wow/character/${realmSlug}/${char.name.toLowerCase()}/professions?namespace=profile-${userRegion}`,
                            {
                                headers: {
                                    'Authorization': `Bearer ${accessToken}`
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
                                        generateCharacterId(extractEnglishText(char.realm), char.name),
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
                                            generateCharacterId(extractEnglishText(char.realm), char.name),
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

                    // Update character data with professions
                    characterData.professions = professions;

                    // Update character in database with profession data
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

    // Update quest zone summaries
    try {
        await database.updateZoneQuestSummary(userId);
        console.log('Updated quest zone summaries');
    } catch (summaryErr) {
        console.error('Failed to update quest zone summaries:', summaryErr.message);
    }

    // Sync quest completion data (with rate limiting)
    let questSyncResult = { charactersProcessed: 0, totalQuests: 0, questsContributedToDatabase: 0 };
    try {
        // Check if quest sync was done recently (within 6 hours)
        const lastQuestSync = await database.getLastQuestSyncTime(userId);
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

        if (forceQuestSync || !lastQuestSync || lastQuestSync <= sixHoursAgo) {
            const reason = forceQuestSync ? 'manual refresh requested' :
                          !lastQuestSync ? 'no previous sync' : 'data is over 6 hours old';
            console.log(`Syncing quest completion data (${reason})...`);
            let charactersProcessed = 0;
            let totalQuests = 0;
            let totalQuestsAddedToSharedDatabase = 0;

            for (const character of characters) {
                try {
                    // Add delay between characters to respect rate limits
                    if (charactersProcessed > 0) {
                        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
                    }

                    // Convert realm name to proper format for Battle.net API
                    const realmSlug = character.realm.toLowerCase().replace(/\s+/g, '-').replace(/['']/g, '').replace(/[^a-z0-9-]/g, '');

                    const completedQuests = await fetchCharacterCompletedQuests(
                        userRegion,
                        realmSlug,
                        character.name,
                        accessToken
                    );

                    // Save completed quest data for this user
                    for (const quest of completedQuests) {
                        await database.upsertCompletedQuest(userId, quest.id);
                    }

                    // Add quests to shared database for community benefit
                    let questsAddedToDatabase = 0;
                    for (const quest of completedQuests) {
                        try {
                            const existingQuest = await database.getQuestFromMaster(quest.id);
                            if (!existingQuest) {
                                const questDetails = await fetchQuestDetails(userRegion, quest.id, accessToken);
                                if (questDetails) {
                                    const questData = {
                                        quest_id: questDetails.id,
                                        quest_name: extractEnglishText(questDetails.name) || `Quest ${questDetails.id}`,
                                        area_id: questDetails.area?.id || null,
                                        area_name: extractEnglishText(questDetails.area?.name) || null,
                                        category_id: questDetails.category?.id || null,
                                        category_name: extractEnglishText(questDetails.category?.name) || null,
                                        type_id: questDetails.type?.id || null,
                                        type_name: extractEnglishText(questDetails.type?.name) || null,
                                        expansion_name: determineExpansionFromQuest(questDetails) || 'Unknown',
                                        is_seasonal: questDetails.id > 60000
                                    };
                                    await database.upsertQuestMaster(questData);
                                    questsAddedToDatabase++;
                                }
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }
                        } catch (questErr) {
                            // Skip quest details fetch errors
                        }
                    }

                    totalQuests += completedQuests.length;
                    totalQuestsAddedToSharedDatabase += questsAddedToDatabase;
                    charactersProcessed++;

                    console.log(`${character.name}: ${completedQuests.length} quests, ${questsAddedToDatabase} contributed to database`);

                } catch (charErr) {
                    console.error(`Failed to sync quests for ${character.name}:`, charErr.message);
                }
            }

            // Update quest sync timestamp
            await database.updateQuestSyncTime(userId);

            questSyncResult = {
                charactersProcessed,
                totalQuests,
                questsContributedToDatabase: totalQuestsAddedToSharedDatabase
            };

            console.log(`Quest sync completed: ${charactersProcessed} characters, ${totalQuests} total quests, ${totalQuestsAddedToSharedDatabase} contributed to shared database`);
        } else {
            console.log('Quest sync skipped - data is recent');
        }
    } catch (questErr) {
        console.error('Failed to sync quest data:', questErr.message);
    }

    return { characters, questSync: questSyncResult };
}

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

        // Check if character data needs auto-refresh (over 12 hours old)
        try {
            const characters = await database.getAllCharacters(user.id);
            if (characters.length > 0) {
                // Find the most recent character update
                const mostRecentUpdate = characters.reduce((latest, char) => {
                    const charUpdate = new Date(char.last_updated);
                    return charUpdate > latest ? charUpdate : latest;
                }, new Date(0));

                const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

                if (mostRecentUpdate < twelveHoursAgo) {
                    console.log(`Auto-refreshing data for ${user.battlenet_tag} - last update: ${mostRecentUpdate.toISOString()}`);

                    // Trigger async refresh after login completes
                    setTimeout(async () => {
                        try {
                            const userRegion = await getUserRegionForAPI(user.id);
                            await refreshUserCharacterData(user.id, accessToken, userRegion, false);
                            console.log(`Auto-refresh completed for ${user.battlenet_tag}`);
                        } catch (refreshError) {
                            console.error(`Auto-refresh failed for ${user.battlenet_tag}:`, refreshError.message);
                        }
                    }, 1000); // Small delay to let login complete first
                }
            }
        } catch (autoRefreshError) {
            console.error('Auto-refresh check failed:', autoRefreshError.message);
        }

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

        const result = await refreshUserCharacterData(userId, req.session.accessToken, userRegion, true);

        // Sort by item level
        result.characters.sort((a, b) => (b.averageItemLevel || 0) - (a.averageItemLevel || 0));

        res.json(result);
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
                const realmSlug = character.realm.toLowerCase().replace(/\s+/g, '-').replace(/['']/g, '').replace(/[^a-z0-9-]/g, '');
                const professionsResponse = await axios.get(
                    `https://${userRegion}.api.blizzard.com/profile/wow/character/${realmSlug}/${character.name.toLowerCase()}/professions?namespace=profile-${userRegion}`,
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
                                                generateCharacterId(character.realm, character.name),
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

// Quest Master Cache population endpoint - now uses job queue
app.post('/api/populate-quest-cache', requireAuth, async (req, res) => {
    try {
        console.log(`🔴 Manual quest cache requested by user ${req.session.userId} (${req.session.battlenetTag})`);

        const userId = req.session.userId;
        const userRegion = await getUserRegionForAPI(userId);
        const battlenetTag = req.session.battlenetTag;

        // Add job to the queue (no time restrictions for manual requests)
        const jobId = questCacheJobQueue.addJob(
            userId,
            userRegion,
            req.session.accessToken,
            battlenetTag
        );

        const job = questCacheJobQueue.getJobStatus(jobId);

        res.json({
            message: 'Quest cache population job queued successfully',
            jobId: jobId,
            queuePosition: job.queuePosition,
            estimatedWaitTime: `${job.queuePosition * 2-3} minutes`,
            statusUrl: `/api/quest-cache-status/${jobId}`
        });

    } catch (error) {
        console.error('Quest cache population error:', error);
        res.status(500).json({
            error: 'Failed to queue quest cache population',
            details: error.message
        });
    }
});

// Get quest cache job status
app.get('/api/quest-cache-status/:jobId', requireAuth, (req, res) => {
    const { jobId } = req.params;
    const job = questCacheJobQueue.getJobStatus(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    // Only allow users to check their own jobs
    if (job.userId !== req.session.userId) {
        return res.status(403).json({ error: 'Access denied' });
    }

    res.json({
        id: job.id,
        status: job.status,
        queuePosition: job.queuePosition,
        progress: job.progress,
        startTime: job.startTime,
        endTime: job.endTime,
        error: job.error,
        estimatedTimeRemaining: job.status === 'queued' ? `${job.queuePosition * 2-3} minutes` : null
    });
});

// Get current queue status (for admin/monitoring)
app.get('/api/quest-cache-queue-status', requireAuth, (req, res) => {
    const queueInfo = {
        totalJobs: questCacheJobQueue.jobs.size,
        pendingJobs: questCacheJobQueue.queue.length,
        isProcessing: questCacheJobQueue.isProcessing,
        rateLimitStatus: {
            currentRPS: questCacheJobQueue.rateLimiter.requestsPerSecond,
            consecutiveErrors: questCacheJobQueue.rateLimiter.consecutiveErrors
        }
    };

    res.json(queueInfo);
});

// Get incomplete quests by zone - for dashboard display
app.get('/api/incomplete-quests-by-zone', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const incompleteZones = await database.getIncompleteQuestsByZone(userId);

        // Process zone names to extract English text from localized JSON
        const processedZones = incompleteZones.map(zone => ({
            ...zone,
            zone_name: extractEnglishText(zone.zone_name) || zone.zone_name
        }));

        res.json({
            zones: processedZones,
            totalZones: processedZones.length
        });
    } catch (error) {
        console.error('Failed to get incomplete quests by zone:', error);
        res.status(500).json({ error: 'Failed to get zone completion data' });
    }
});

// Get detailed list of incomplete quests for a specific zone
app.get('/api/incomplete-quests-detail/:zoneName', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const zoneName = decodeURIComponent(req.params.zoneName);

        const incompleteQuests = await database.getIncompleteQuestDetailsForZone(userId, zoneName);

        // Add Wowhead URLs to each quest
        const questsWithUrls = incompleteQuests.map(quest => ({
            ...quest,
            wowhead_url: `https://www.wowhead.com/quest=${quest.quest_id}`
        }));

        res.json({
            zone_name: zoneName,
            incomplete_quests: questsWithUrls,
            total_incomplete: questsWithUrls.length
        });
    } catch (error) {
        console.error(`Failed to get incomplete quest details for zone ${req.params.zoneName}:`, error);
        res.status(500).json({ error: 'Failed to get quest details for zone' });
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
                        console.log(`Cached ${recipeCount} recipes for ${extractEnglishText(profession)} - ${extractEnglishText(skillTier)}`);
                        
                        // Small delay to avoid hitting API limits
                        await new Promise(resolve => setTimeout(resolve, 100));
                        
                    } catch (tierErr) {
                        console.error(`Failed to cache tier ${extractEnglishText(skillTier)} for ${extractEnglishText(profession)}:`, tierErr.message);
                    }
                }
                
                processedProfessions.push(extractEnglishText(profession));
                
            } catch (profErr) {
                console.error(`Failed to process profession ${extractEnglishText(profession)}:`, profErr.message);
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

// Auction House and Profession Planning Endpoints

// Get recipe cost analysis for a profession
app.get('/api/profession-cost-analysis/:professionName', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const professionName = req.params.professionName;
        const userRegion = await getUserRegionForAPI(userId);

        // Get user's main character for this profession (or first character with this profession)
        const characters = await database.getAllCharacters(userId);

        // Debug logging to see what professions we have
        console.log(`Looking for profession: "${professionName}"`);
        const allProfessions = characters.flatMap(char =>
            (char.professions_list || '').split(', ').filter(p => p.trim() !== '')
        );
        console.log('Available professions:', [...new Set(allProfessions)]);

        const professionCharacter = characters.find(char => {
            if (!char.professions_list) return false;
            const charProfessions = char.professions_list.split(', ').map(p => p.trim().toLowerCase());
            return charProfessions.includes(professionName.toLowerCase());
        });

        if (!professionCharacter) {
            return res.status(404).json({ error: 'No character found with this profession' });
        }

        // Get connected realm ID
        const realmSlug = professionCharacter.realm.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/['']/g, '')
            .replace(/[^a-z0-9-]/g, '');

        let connectedRealmId;
        try {
            connectedRealmId = await getConnectedRealmId(realmSlug, userRegion);
        } catch (realmError) {
            console.error('Failed to get connected realm ID:', realmError.message);
            return res.status(500).json({ error: 'Could not determine realm auction house' });
        }

        // Update auction house data (on-demand for now)
        try {
            await updateAuctionHouseData(connectedRealmId, userRegion);
        } catch (auctionError) {
            console.error('Failed to update auction house data:', auctionError.message);
            // Continue anyway with existing data
        }

        console.log(`Found character: ${professionCharacter.name} on ${professionCharacter.realm}`);
        console.log(`Connected realm ID: ${connectedRealmId}`);

        // Get recipe cost analysis
        const costAnalysis = await database.getRecipeCostAnalysis(userId, connectedRealmId, professionName);
        console.log(`Recipe cost analysis returned ${costAnalysis.length} recipes`);

        // Calculate totals
        let totalCost = 0;
        let availableRecipes = 0;
        let missingFromAH = 0;

        costAnalysis.forEach(recipe => {
            if (recipe.lowest_price) {
                totalCost += parseInt(recipe.lowest_price);
                availableRecipes++;
            } else {
                missingFromAH++;
            }
        });

        res.json({
            success: true,
            profession: professionName,
            character: {
                name: professionCharacter.name,
                realm: professionCharacter.realm
            },
            connected_realm_id: connectedRealmId,
            summary: {
                total_missing_recipes: costAnalysis.length,
                available_on_ah: availableRecipes,
                missing_from_ah: missingFromAH,
                total_cost_copper: totalCost,
                total_cost_gold: Math.floor(totalCost / 10000),
                avg_price_per_recipe: availableRecipes > 0 ? Math.round(totalCost / availableRecipes) : 0
            },
            recipes: costAnalysis
        });

    } catch (error) {
        console.error('Recipe cost analysis error:', error);
        res.status(500).json({ error: 'Failed to analyze recipe costs' });
    }
});

// Set profession main character
app.post('/api/profession-main', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { professionName, characterId, priority = 1 } = req.body;

        if (!professionName || !characterId) {
            return res.status(400).json({ error: 'Profession name and character ID are required' });
        }

        await database.setProfessionMain(userId, professionName, characterId, priority);

        res.json({
            success: true,
            message: `Set ${characterId} as priority ${priority} for ${professionName}`
        });

    } catch (error) {
        console.error('Set profession main error:', error);
        res.status(500).json({ error: 'Failed to set profession main' });
    }
});

// Get profession mains
app.get('/api/profession-mains', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const professionMains = await database.getProfessionMains(userId);

        res.json({
            success: true,
            assignments: professionMains
        });

    } catch (error) {
        console.error('Get profession mains error:', error);
        res.status(500).json({ error: 'Failed to get profession mains' });
    }
});

// Get auction house price for a specific item
app.get('/api/auction-price/:itemId', requireAuth, async (req, res) => {
    try {
        const { itemId } = req.params;
        const userId = req.session.userId;

        // Validate itemId
        if (!itemId || itemId === 'undefined' || isNaN(parseInt(itemId))) {
            console.error(`Invalid itemId received: "${itemId}"`);
            return res.status(400).json({ error: 'Invalid item ID provided' });
        }

        const itemIdInt = parseInt(itemId);
        const userRegion = await getUserRegionForAPI(userId);

        // Get user's main realm (or first character's realm)
        const characters = await database.getAllCharacters(userId);
        if (characters.length === 0) {
            return res.status(404).json({ error: 'No characters found' });
        }

        const mainCharacter = characters[0]; // Use first character for realm
        const realmSlug = mainCharacter.realm.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/['']/g, '')
            .replace(/[^a-z0-9-]/g, '');

        let connectedRealmId;
        try {
            connectedRealmId = await getConnectedRealmId(realmSlug, userRegion);
        } catch (realmError) {
            console.error('Failed to get connected realm ID for pricing:', realmError.message);
            return res.status(500).json({ error: 'Could not determine realm for pricing' });
        }

        // Get current auction price
        const priceData = await database.getCurrentAuctionPrice(itemIdInt, connectedRealmId);

        if (priceData) {
            res.json({
                success: true,
                item_id: itemIdInt,
                price: priceData.lowest_price,
                quantity: priceData.total_quantity,
                is_commodity: priceData.connected_realm_id === 0,
                last_updated: priceData.last_seen,
                realm: mainCharacter.realm
            });
        } else {
            res.json({
                success: false,
                item_id: itemIdInt,
                error: 'No auction data found'
            });
        }

    } catch (error) {
        console.error('Get auction price error:', error);
        res.status(500).json({ error: 'Failed to get auction price' });
    }
});

// Get auction house prices for multiple items (bulk)
app.post('/api/auction-prices-bulk', requireAuth, async (req, res) => {
    try {
        const { itemIds } = req.body;
        const userId = req.session.userId;

        // Validate input
        if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty itemIds array' });
        }

        // Limit bulk requests to prevent abuse
        if (itemIds.length > 1000) {
            return res.status(400).json({ error: 'Too many items requested (max 1000)' });
        }

        const userRegion = await getUserRegionForAPI(userId);

        // Get user's main realm (or first character's realm)
        const characters = await database.getAllCharacters(userId);
        if (characters.length === 0) {
            return res.status(404).json({ error: 'No characters found' });
        }

        const mainCharacter = characters[0]; // Use first character for realm
        const realmSlug = mainCharacter.realm.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/['']/g, '')
            .replace(/[^a-z0-9-]/g, '');

        let connectedRealmId;
        try {
            connectedRealmId = await getConnectedRealmId(realmSlug, userRegion);
        } catch (realmError) {
            console.error('Failed to get connected realm ID for bulk pricing:', realmError.message);
            return res.status(500).json({ error: 'Could not determine realm for pricing' });
        }

        // Get bulk auction prices using existing function
        const priceData = await database.getCurrentAuctionPrices(connectedRealmId, itemIds, userRegion);

        // Convert array to object with item_id as key
        const pricesMap = {};
        priceData.forEach(item => {
            pricesMap[item.item_id] = {
                item_id: item.item_id,
                lowest_price: item.lowest_price,
                avg_price: item.avg_price,
                total_quantity: item.total_quantity,
                auction_count: item.auction_count,
                is_commodity: item.auction_type === 'commodity',
                last_updated: item.last_updated
            };
        });

        res.json({
            success: true,
            realm: mainCharacter.realm,
            connected_realm_id: connectedRealmId,
            items_requested: itemIds.length,
            items_found: priceData.length,
            prices: pricesMap
        });

    } catch (error) {
        console.error('Get bulk auction prices error:', error);
        res.status(500).json({ error: 'Failed to get bulk auction prices' });
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

// Recalculate zone summaries manually
app.post('/api/recalculate-zone-summaries', requireAuth, async (req, res) => {
    try {
        await database.updateZoneQuestSummary(req.session.userId);
        res.json({ success: true, message: 'Zone summaries recalculated successfully' });
    } catch (error) {
        console.error('Failed to recalculate zone summaries:', error);
        res.status(500).json({ error: 'Failed to recalculate zone summaries' });
    }
});

// Debug endpoint to check raw zone data in cached_quests
app.get('/api/debug/zone-data', requireAuth, async (req, res) => {
    try {
        const client = await database.pool.connect();
        try {
            // Get all unique zone/expansion combinations with quest counts
            const result = await client.query(`
                SELECT
                    zone_name,
                    expansion_name,
                    COUNT(*) as quest_count
                FROM cached_quests
                WHERE zone_name ILIKE '%zuldazar%' OR zone_name ILIKE '%nazjatar%'
                GROUP BY zone_name, expansion_name
                ORDER BY zone_name, expansion_name
            `);

            res.json(result.rows);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Failed to get zone debug data:', error);
        res.status(500).json({ error: 'Failed to get zone debug data' });
    }
});

// Debug endpoint to check current zone_quest_summary table
app.get('/api/debug/zone-summary-table', requireAuth, async (req, res) => {
    try {
        const client = await database.pool.connect();
        try {
            const result = await client.query(`
                SELECT * FROM zone_quest_summary
                WHERE user_id = $1
                AND (zone_name ILIKE '%zuldazar%' OR zone_name ILIKE '%nazjatar%')
                ORDER BY zone_name, expansion_name
            `, [req.session.userId]);

            res.json(result.rows);
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Failed to get zone summary debug data:', error);
        res.status(500).json({ error: 'Failed to get zone summary debug data' });
    }
});

// Changelog API endpoints
app.get('/api/changelog', (req, res) => {
    try {
        const versionData = require('./version-tracking.json');
        res.json(versionData);
    } catch (error) {
        console.error('Failed to load version tracking:', error);
        res.status(500).json({ error: 'Failed to load changelog' });
    }
});

// Create new version (moves unreleased to released)
app.post('/api/create-version', async (req, res) => {
    try {
        const { version, title, type = 'feature' } = req.body;
        if (!version || !title) {
            return res.status(400).json({ error: 'Version and title are required' });
        }

        const versionData = require('./version-tracking.json');

        // Move unreleased items to new version
        versionData.releases[version] = {
            date: new Date().toISOString().split('T')[0],
            title: title,
            changes: [...(versionData.unreleased || [])],
            type: type
        };

        // Update current version and clear unreleased
        versionData.currentVersion = version;
        versionData.currentVersionDate = new Date().toISOString().split('T')[0];
        versionData.unreleased = [];

        // Save updated version data
        fs.writeFileSync('./version-tracking.json', JSON.stringify(versionData, null, 2));

        // Generate Discord-friendly markdown
        const discordMarkdown = generateDiscordMarkdown(version, versionData.releases[version]);

        res.json({
            success: true,
            version,
            discordMarkdown,
            changelog: versionData
        });
    } catch (error) {
        console.error('Failed to create version:', error);
        res.status(500).json({ error: 'Failed to create version' });
    }
});

// Character ID migration endpoint (admin)
app.post('/api/migrate-character-ids', async (req, res) => {
    try {
        await migrateCharacterIds();
        res.json({ success: true, message: 'Character ID migration completed successfully' });
    } catch (error) {
        console.error('Failed to migrate character IDs:', error);
        res.status(500).json({ error: 'Failed to migrate character IDs' });
    }
});

// Auction House Admin Endpoints

// Update auction house data for all realms (admin)
app.post('/api/admin/update-auction-house', async (req, res) => {
    try {
        console.log('🏪 Manual auction house update triggered by admin');

        // Get all unique realms from our user database
        const client = await database.pool.connect();
        let realmsUpdated = 0;
        let commoditiesUpdated = 0;
        const updateDetails = [];

        try {
            // First, update regional commodities for both US and EU
            const regions = ['us', 'eu'];
            for (const region of regions) {
                try {
                    console.log(`📦 Updating ${region.toUpperCase()} regional commodities...`);
                    await updateRegionalCommodities(region);
                    commoditiesUpdated++;
                    updateDetails.push({
                        type: 'commodities',
                        region: region.toUpperCase(),
                        status: 'success'
                    });
                } catch (error) {
                    console.error(`❌ Failed to update ${region.toUpperCase()} commodities:`, error.message);
                    updateDetails.push({
                        type: 'commodities',
                        region: region.toUpperCase(),
                        status: 'failed',
                        error: error.message
                    });
                }
            }

            // Then update connected realm auction houses
            const realmsResult = await client.query(`
                SELECT DISTINCT c.realm, u.region
                FROM characters c
                JOIN users u ON c.user_id = u.id
                WHERE c.realm IS NOT NULL
                AND c.realm != ''
                AND u.region IS NOT NULL
            `);

            for (const row of realmsResult.rows) {
                const realmSlug = row.realm;
                const region = row.region || 'us'; // Default to US if no region

                try {

                    // Get connected realm ID for this realm and region
                    const connectedRealmId = await getConnectedRealmId(realmSlug, region);

                    // Update auction house data with proper region
                    await updateAuctionHouseData(connectedRealmId, region);

                    realmsUpdated++;
                    updateDetails.push({
                        realm: realmSlug,
                        region: region.toUpperCase(),
                        connectedRealmId,
                        status: 'success'
                    });

                    // Small delay between realm updates to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`❌ Failed to update auction house data for realm ${connectedRealmId}:`, error.message);
                    updateDetails.push({
                        realm: realmSlug,
                        region: region.toUpperCase(),
                        status: 'failed',
                        error: error.message
                    });
                }
            }

        } finally {
            client.release();
        }

        res.json({
            success: true,
            realmsUpdated,
            commoditiesUpdated,
            totalUpdates: updateDetails.length,
            details: updateDetails,
            message: `Updated auction data: ${commoditiesUpdated} commodity regions, ${realmsUpdated} connected realms`
        });
    } catch (error) {
        console.error('❌ Failed to update auction house data:', error);
        res.status(500).json({ error: 'Failed to update auction house data: ' + error.message });
    }
});

// Get auction house status (admin)
app.get('/api/admin/auction-house-status', async (req, res) => {
    try {
        const client = await database.pool.connect();
        try {
            // Get auction data freshness by realm
            const auctionStatus = await client.query(`
                SELECT
                    realm_slug,
                    COUNT(*) as auction_count,
                    MAX(last_updated) as last_updated,
                    MIN(last_updated) as oldest_data,
                    AVG(price) as avg_price
                FROM current_auctions
                GROUP BY realm_slug
                ORDER BY last_updated DESC
            `);

            // Get price history data status
            const priceHistoryStatus = await client.query(`
                SELECT
                    COUNT(*) as total_price_records,
                    COUNT(DISTINCT item_id) as unique_items,
                    COUNT(DISTINCT realm_slug) as realms_with_price_data,
                    MAX(last_seen) as most_recent_price,
                    MIN(last_seen) as oldest_price
                FROM auction_prices
            `);

            // Get profession mains status
            const professionStatus = await client.query(`
                SELECT
                    COUNT(*) as total_assignments,
                    COUNT(DISTINCT user_id) as users_with_mains,
                    COUNT(DISTINCT profession_name) as professions_assigned
                FROM profession_mains
            `);

            res.json({
                success: true,
                realmsWithData: auctionStatus.rows.length,
                auctionData: auctionStatus.rows,
                priceHistory: priceHistoryStatus.rows[0],
                professionMains: professionStatus.rows[0],
                lastUpdated: new Date().toISOString()
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ Failed to get auction house status:', error);
        res.status(500).json({ error: 'Failed to get auction house status: ' + error.message });
    }
});

// Cleanup old auction data (admin)
app.post('/api/admin/cleanup-auction-data', async (req, res) => {
    try {
        const client = await database.pool.connect();
        let recordsRemoved = 0;

        try {
            // Remove auction data older than 24 hours
            const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);

            // Clean current_auctions
            const currentAuctionsResult = await client.query(`
                DELETE FROM current_auctions
                WHERE last_updated < $1
            `, [cutoffTime]);

            // Clean old auction_prices (keep only last 30 days)
            const pricesCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const pricesResult = await client.query(`
                DELETE FROM auction_prices
                WHERE last_seen < $1
            `, [pricesCutoff]);

            recordsRemoved = currentAuctionsResult.rowCount + pricesResult.rowCount;

            console.log(`🧹 Cleaned up ${recordsRemoved} old auction records`);

        } finally {
            client.release();
        }

        res.json({
            success: true,
            recordsRemoved,
            message: `Removed ${recordsRemoved} old auction records`
        });
    } catch (error) {
        console.error('❌ Failed to cleanup auction data:', error);
        res.status(500).json({ error: 'Failed to cleanup auction data: ' + error.message });
    }
});

// Database migration endpoint (admin)
app.post('/api/admin/run-migrations', async (req, res) => {
    try {
        console.log('🔄 Manual database migration triggered by admin');

        const client = await database.pool.connect();
        try {
            // Add region column to auction_prices if it doesn't exist
            await client.query(`
                ALTER TABLE auction_prices
                ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'us'
            `);

            // Add region column to current_auctions if it doesn't exist
            await client.query(`
                ALTER TABLE current_auctions
                ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'us'
            `);

            // Update existing records to have 'us' region if null
            const updateResult1 = await client.query(`
                UPDATE auction_prices
                SET region = 'us'
                WHERE region IS NULL
            `);

            const updateResult2 = await client.query(`
                UPDATE current_auctions
                SET region = 'us'
                WHERE region IS NULL
            `);

            res.json({
                success: true,
                message: 'Database migrations completed successfully',
                details: {
                    auction_prices_updated: updateResult1.rowCount,
                    current_auctions_updated: updateResult2.rowCount
                }
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ Failed to run migrations:', error);
        res.status(500).json({ error: 'Failed to run migrations: ' + error.message });
    }
});

// Cross-Server Optimization API Endpoints

// Get cross-server price comparison for an item
app.get('/api/cross-server/price-comparison/:itemId/:region', requireAuth, async (req, res) => {
    try {
        const { itemId, region } = req.params;

        const client = await database.pool.connect();
        try {
            // Get current prices across all connected realms for this region
            const result = await client.query(`
                SELECT
                    ca.connected_realm_id,
                    ca.lowest_price,
                    ca.avg_price,
                    ca.total_quantity,
                    ca.auction_count,
                    ca.last_updated,
                    STRING_AGG(DISTINCT cr.realm_name, ', ') as realm_names,
                    STRING_AGG(DISTINCT cr.realm_slug, ', ') as realm_slugs
                FROM current_auctions ca
                JOIN connected_realms cr ON ca.connected_realm_id = cr.connected_realm_id
                    AND ca.region = cr.region
                WHERE ca.item_id = $1 AND ca.region = $2
                GROUP BY ca.connected_realm_id, ca.lowest_price, ca.avg_price,
                         ca.total_quantity, ca.auction_count, ca.last_updated
                ORDER BY ca.lowest_price ASC
            `, [parseInt(itemId), region]);

            // Process realm names to extract English text
            const processedRows = result.rows.map(row => {
                const realmNames = row.realm_names.split(', ').map(name => {
                    try {
                        // Try to parse as JSON first
                        const parsed = JSON.parse(name);
                        return extractEnglishText(parsed) || name;
                    } catch (e) {
                        // If not JSON, use as-is
                        return name;
                    }
                }).join(', ');

                return {
                    ...row,
                    realm_names: realmNames
                };
            });

            res.json({
                success: true,
                itemId: parseInt(itemId),
                region,
                priceComparison: processedRows,
                cheapestRealm: processedRows.length > 0 ? processedRows[0] : null,
                totalRealms: processedRows.length
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ Failed to get cross-server price comparison:', error);
        res.status(500).json({ error: 'Failed to get cross-server price comparison: ' + error.message });
    }
});

// Get arbitrage opportunities for a profession
app.get('/api/cross-server/arbitrage/:professionName/:region', requireAuth, async (req, res) => {
    try {
        const { professionName, region } = req.params;
        const maxInvestment = parseInt(req.query.maxInvestment) || 1000000; // Default 100g

        const client = await database.pool.connect();
        try {
            // Find items with significant price differences across realms
            const result = await client.query(`
                WITH profession_items AS (
                    SELECT DISTINCT recipe_id as item_id
                    FROM cached_recipes
                    WHERE profession_name = $1
                ),
                price_stats AS (
                    SELECT
                        ca.item_id,
                        ca.connected_realm_id,
                        ca.lowest_price,
                        ca.total_quantity,
                        STRING_AGG(cr.realm_name, ', ') as realm_names,
                        MIN(ca.lowest_price) OVER (PARTITION BY ca.item_id) as global_min_price,
                        MAX(ca.lowest_price) OVER (PARTITION BY ca.item_id) as global_max_price
                    FROM current_auctions ca
                    JOIN connected_realms cr ON ca.connected_realm_id = cr.connected_realm_id
                        AND ca.region = cr.region
                    JOIN profession_items pi ON ca.item_id = pi.item_id
                    WHERE ca.region = $2
                    AND ca.lowest_price <= $3
                )
                SELECT
                    item_id,
                    connected_realm_id,
                    realm_names,
                    lowest_price,
                    total_quantity,
                    global_min_price,
                    global_max_price,
                    (global_max_price - global_min_price) as potential_profit,
                    ROUND(((global_max_price - global_min_price)::DECIMAL / global_min_price) * 100, 2) as profit_percentage
                FROM price_stats
                WHERE global_max_price > global_min_price * 1.2  -- At least 20% difference
                AND lowest_price = global_min_price  -- Only show the cheapest realms
                ORDER BY profit_percentage DESC, potential_profit DESC
                LIMIT 20
            `, [professionName, region, maxInvestment]);

            res.json({
                success: true,
                professionName,
                region,
                maxInvestment,
                arbitrageOpportunities: result.rows,
                opportunityCount: result.rows.length
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('❌ Failed to get arbitrage opportunities:', error);
        res.status(500).json({ error: 'Failed to get arbitrage opportunities: ' + error.message });
    }
});

// Get connected realms mapping for a region
app.get('/api/connected-realms/:region', requireAuth, async (req, res) => {
    try {
        const { region } = req.params;
        const realms = await database.getConnectedRealms(region);

        // Group by connected_realm_id
        const realmGroups = {};
        realms.forEach(realm => {
            if (!realmGroups[realm.connected_realm_id]) {
                realmGroups[realm.connected_realm_id] = {
                    connected_realm_id: realm.connected_realm_id,
                    region: realm.region,
                    realms: []
                };
            }
            realmGroups[realm.connected_realm_id].realms.push({
                slug: realm.realm_slug,
                name: realm.realm_name,
                locale: realm.locale,
                timezone: realm.timezone,
                population: realm.population
            });
        });

        res.json({
            success: true,
            region,
            connectedRealmGroups: Object.values(realmGroups),
            totalRealms: realms.length
        });
    } catch (error) {
        console.error('❌ Failed to get connected realms:', error);
        res.status(500).json({ error: 'Failed to get connected realms: ' + error.message });
    }
});

// Update connected realm mapping (admin)
app.post('/api/admin/update-connected-realms/:region', async (req, res) => {
    try {
        const { region } = req.params;
        console.log(`🌐 Updating connected realm mapping for ${region.toUpperCase()}...`);

        const accessToken = await getClientCredentialsToken(region);
        let realmGroupsUpdated = 0;

        // Get list of all connected realms for the region
        const connectedRealmsResponse = await axios.get(
            `https://${region}.api.blizzard.com/data/wow/connected-realm/index?namespace=dynamic-${region}`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }
        );

        if (connectedRealmsResponse.data?.connected_realms) {
            for (const connectedRealmRef of connectedRealmsResponse.data.connected_realms) {
                // Extract connected realm ID from URL
                const urlParts = connectedRealmRef.href.split('/');
                const connectedRealmId = parseInt(urlParts[urlParts.length - 1].split('?')[0]);

                try {
                    // Get detailed data for this connected realm
                    const detailResponse = await axios.get(connectedRealmRef.href, {
                        headers: {
                            'Authorization': `Bearer ${accessToken}`
                        }
                    });

                    if (detailResponse.data) {
                        await database.updateConnectedRealmMapping(connectedRealmId, detailResponse.data, region);
                        realmGroupsUpdated++;
                    }

                    // Rate limiting delay
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error(`❌ Failed to update connected realm ${connectedRealmId}:`, error.message);
                }
            }
        }

        res.json({
            success: true,
            region,
            realmGroupsUpdated,
            message: `Updated ${realmGroupsUpdated} connected realm groups for ${region.toUpperCase()}`
        });
    } catch (error) {
        console.error('❌ Failed to update connected realms:', error);
        res.status(500).json({ error: 'Failed to update connected realms: ' + error.message });
    }
});

// Quest zone summary endpoint
app.get('/api/quest-zones-summary', requireAuth, async (req, res) => {
    try {
        const expansionFilter = req.query.expansion || 'all';
        const zones = await database.getZoneQuestSummary(req.session.userId, expansionFilter);
        res.json(zones);
    } catch (error) {
        console.error('Quest zones summary error:', error);
        res.status(500).json({ error: 'Failed to get quest zones summary' });
    }
});

// Get quest cache status
app.get('/api/quest-cache-status', requireAuth, async (req, res) => {
    try {
        const status = await database.getQuestCacheStatus();
        res.json(status);
    } catch (error) {
        console.error('Quest cache status error:', error);
        res.status(500).json({ error: 'Failed to get quest cache status' });
    }
});

// Debug endpoint to manually trigger quest cache update
app.post('/api/update-quest-cache', requireAuth, async (req, res) => {
    try {
        console.log('Manual quest cache update triggered');
        await updateQuestCacheFromCompletedQuests();
        res.json({ success: true, message: 'Quest cache update completed' });
    } catch (error) {
        console.error('Manual quest cache update error:', error);
        res.status(500).json({ error: 'Failed to update quest cache' });
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
// Collection Analytics API Endpoints
app.get('/api/collection/stats/:userId', requireAuth, async (req, res) => {
    try {
        const { userId } = req.params;

        // Get profession collection stats
        const professionStats = await database.getProfessionCollectionStats(userId);

        // Calculate overall stats
        const totalProfessions = professionStats.length;
        const avgCompletion = professionStats.reduce((sum, prof) => sum + prof.completion_percentage, 0) / totalProfessions;
        const totalRecipes = professionStats.reduce((sum, prof) => sum + prof.total_possible, 0);
        const totalCollected = professionStats.reduce((sum, prof) => sum + prof.total_collected, 0);

        res.json({
            success: true,
            professionStats,
            overallStats: {
                totalProfessions,
                avgCompletion: Math.round(avgCompletion * 100) / 100,
                totalRecipes,
                totalCollected,
                overallCompletion: Math.round((totalCollected / totalRecipes) * 10000) / 100
            }
        });
    } catch (error) {
        console.error('❌ Failed to get collection stats:', error);
        res.status(500).json({ error: 'Failed to get collection stats: ' + error.message });
    }
});

app.get('/api/collection/velocity/:userId/:category', requireAuth, async (req, res) => {
    try {
        const { userId, category } = req.params;
        const { subcategory, timeframe = 7 } = req.query;

        const velocity = await database.calculateCollectionVelocity(
            userId,
            category,
            subcategory || null,
            parseInt(timeframe)
        );

        if (!velocity) {
            return res.json({
                success: true,
                velocity: null,
                message: 'Insufficient data for velocity calculation'
            });
        }

        res.json({
            success: true,
            velocity: {
                ...velocity,
                velocityPerWeek: velocity.velocityPerDay * 7,
                velocityPerMonth: velocity.velocityPerDay * 30
            }
        });
    } catch (error) {
        console.error('❌ Failed to calculate velocity:', error);
        res.status(500).json({ error: 'Failed to calculate velocity: ' + error.message });
    }
});

app.get('/api/collection/projections/:userId/:category', requireAuth, async (req, res) => {
    try {
        const { userId, category } = req.params;
        const { subcategory, targetCompletion = 100 } = req.query;

        const projection = await database.generateCompletionProjection(
            userId,
            category,
            subcategory || null,
            parseFloat(targetCompletion)
        );

        if (!projection) {
            return res.json({
                success: true,
                projection: null,
                message: 'Insufficient data for projection or no progress detected'
            });
        }

        res.json({
            success: true,
            projection
        });
    } catch (error) {
        console.error('❌ Failed to generate projection:', error);
        res.status(500).json({ error: 'Failed to generate projection: ' + error.message });
    }
});

app.post('/api/collection/snapshot', requireAuth, async (req, res) => {
    try {
        const { userId, category, subcategory, totalPossible, totalCollected, metadata } = req.body;

        if (!userId || !category || typeof totalPossible !== 'number' || typeof totalCollected !== 'number') {
            return res.status(400).json({ error: 'Missing required fields: userId, category, totalPossible, totalCollected' });
        }

        const snapshotId = await database.createCollectionSnapshot(
            userId,
            category,
            subcategory,
            totalPossible,
            totalCollected,
            metadata
        );

        res.json({
            success: true,
            snapshotId
        });
    } catch (error) {
        console.error('❌ Failed to create collection snapshot:', error);
        res.status(500).json({ error: 'Failed to create collection snapshot: ' + error.message });
    }
});

app.get('/api/collection/history/:userId/:category', requireAuth, async (req, res) => {
    try {
        const { userId, category } = req.params;
        const { subcategory, daysBack = 30 } = req.query;

        const history = await database.getCollectionHistory(
            userId,
            category,
            subcategory || null,
            parseInt(daysBack)
        );

        res.json({
            success: true,
            history
        });
    } catch (error) {
        console.error('❌ Failed to get collection history:', error);
        res.status(500).json({ error: 'Failed to get collection history: ' + error.message });
    }
});

const server = app.listen(PORT, async () => {
    console.log(`✨ Warband Tracker (PostgreSQL) running on http://localhost:${PORT}`);
    console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📁 Database: ${path.join(__dirname, 'data', 'wow_characters.db')}`);

    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        console.warn('⚠️  WARNING: SESSION_SECRET is not set or too short. Set a strong secret in production!');
    }

    // Initialize database and start background services
    try {
        await database.initDatabase();
        // Database initialization logged in database module

        // Run character ID migration
        await migrateCharacterIds();

        // Start periodic quest discovery service
        await startPeriodicQuestDiscovery();
        // Background services started

    } catch (error) {
        console.error('❌ Initialization error:', error);
    }
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
    console.log(`${signal} signal received: closing HTTP server`);

    // Stop background services
    stopPeriodicQuestDiscovery();

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
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = app;