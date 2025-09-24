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
                    console.log(`Skipped quest ${questId}: ${questError.message}`);
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

// Background quest discovery service
async function backgroundQuestDiscovery(region, accessToken, maxQuests = 2000) {
    console.log('🔍 Starting background quest discovery...');

    const questRanges = [
        { start: 1, end: 15000, name: 'Classic', sample: 100 },
        { start: 9000, end: 12000, name: 'Burning Crusade', sample: 60 },
        { start: 11000, end: 14500, name: 'Wrath of the Lich King', sample: 70 },
        { start: 14000, end: 29000, name: 'Cataclysm', sample: 150 },
        { start: 28000, end: 35000, name: 'Mists of Pandaria', sample: 70 },
        { start: 33000, end: 40000, name: 'Warlords of Draenor', sample: 70 },
        { start: 38000, end: 48000, name: 'Legion', sample: 100 },
        { start: 46000, end: 58000, name: 'Battle for Azeroth', sample: 120 },
        { start: 57000, end: 66000, name: 'Shadowlands', sample: 90 },
        { start: 65000, end: 85000, name: 'Dragonflight & War Within', sample: 200 }
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

// Periodic quest discovery service (runs every 6 hours)
let questDiscoveryInterval = null;

async function startPeriodicQuestDiscovery() {
    // Don't start if already running
    if (questDiscoveryInterval) return;

    console.log('🚀 Starting periodic quest discovery service...');

    const runDiscovery = async () => {
        try {
            // Get a client credentials token for the discovery
            const accessToken = await getClientCredentialsToken('us'); // Default to US region

            // Run background discovery with smaller batches for periodic runs
            await backgroundQuestDiscovery('us', accessToken, 500);

            console.log('⏰ Next quest discovery in 6 hours...');
        } catch (error) {
            console.error('❌ Periodic quest discovery error:', error);
        }
    };

    // Run immediately on startup (after a short delay)
    setTimeout(runDiscovery, 30000); // 30 second delay after server start

    // Then run every 6 hours
    questDiscoveryInterval = setInterval(runDiscovery, 6 * 60 * 60 * 1000);
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

                        // Quest data is now synced separately to avoid rate limiting

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

// Quest sync endpoint - separate from character refresh to avoid rate limiting
app.post('/api/sync-quests', requireAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    try {
        const userId = req.session.userId;
        const userRegion = await getUserRegionForAPI(userId);

        // Check if quest sync was done recently (within 6 hours)
        const lastQuestSync = await database.getLastQuestSyncTime(userId);
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

        if (lastQuestSync && lastQuestSync > sixHoursAgo) {
            return res.json({
                message: 'Quest data is up to date',
                lastSync: lastQuestSync,
                charactersProcessed: 0
            });
        }

        // Get user's characters
        const characters = await database.getAllCharacters(userId);
        let charactersProcessed = 0;
        let totalQuests = 0;
        let totalQuestsAddedToSharedDatabase = 0;

        for (const character of characters) {
            try {
                // Add delay between characters to respect rate limits
                if (charactersProcessed > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
                }

                // Convert realm name to proper slug format for Battle.net API
                const realmSlug = character.realm.toLowerCase().replace(/[\s']/g, '-').replace(/[^a-z0-9-]/g, '');

                const completedQuests = await fetchCharacterCompletedQuests(
                    userRegion,
                    realmSlug,
                    character.name,
                    req.session.accessToken
                );

                // Save completed quest data for this user
                for (const quest of completedQuests) {
                    await database.upsertCompletedQuest(userId, quest.id);
                }

                // ENHANCEMENT: Add these quests to the shared quest database
                // This helps build a comprehensive quest database for ALL users
                let questsAddedToDatabase = 0;
                for (const quest of completedQuests) {
                    try {
                        // Check if we already have this quest in the master database
                        const existingQuest = await database.getQuestFromMaster(quest.id);

                        if (!existingQuest) {
                            // Get quest details and add to shared database
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
                                    expansion_name: determineExpansionFromQuest(questDetails) || null,
                                    is_seasonal: questDetails.id > 60000
                                };

                                await database.upsertQuestMaster(questData);
                                questsAddedToDatabase++;
                            }

                            // Small delay to respect rate limits
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                    } catch (questErr) {
                        // Silently continue - quest details might not be available
                    }
                }

                charactersProcessed++;
                totalQuests += completedQuests.length;
                totalQuestsAddedToSharedDatabase += questsAddedToDatabase;

                console.log(`Synced ${completedQuests.length} quests for ${character.name} (${questsAddedToDatabase} added to shared database)`);

            } catch (questErr) {
                console.error(`Failed to sync quests for ${character.name}:`, questErr.message);
                // Continue with other characters even if one fails
            }
        }

        // Update last sync time
        await database.updateQuestSyncTime(userId);

        res.json({
            message: totalQuestsAddedToSharedDatabase > 0
                ? `Quest sync completed! Added ${totalQuestsAddedToSharedDatabase} new quests to the shared database for all users.`
                : 'Quest sync completed',
            charactersProcessed,
            totalQuests,
            questsContributedToDatabase: totalQuestsAddedToSharedDatabase,
            lastSync: new Date()
        });

    } catch (error) {
        console.error('Quest sync failed:', error);
        res.status(500).json({ error: 'Failed to sync quest data' });
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

// Quest Master Cache population endpoint
app.post('/api/populate-quest-cache', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const userRegion = await getUserRegionForAPI(userId);
        const accessToken = await getClientCredentialsToken(userRegion);

        console.log('Starting intelligent quest cache population...');

        // HYBRID APPROACH: Build quest database from multiple sources
        // 1. Your completed quests (known to exist)
        // 2. Quest ID range scanning (find more quests)
        // 3. Cross-reference with Battle.net API for details

        const characters = await database.getAllCharacters(userId);
        if (characters.length === 0) {
            return res.json({
                message: 'No characters found. Please refresh character data first.',
                results: { questsProcessed: 0, questsFailed: 0, totalQuests: 0 }
            });
        }

        let processed = 0;
        let failed = 0;
        let skipped = 0;
        const seenQuests = new Set();

        // Phase 1: Get all completed quests from your characters
        for (const character of characters) {
            try {
                if (processed > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // Convert realm name to proper slug format for Battle.net API
                const realmSlug = character.realm.toLowerCase().replace(/[\s']/g, '-').replace(/[^a-z0-9-]/g, '');

                const completedQuests = await fetchCharacterCompletedQuests(
                    userRegion,
                    realmSlug,
                    character.name,
                    req.session.accessToken
                );

                console.log(`${character.name}: Found ${completedQuests.length} completed quests`);

                // Just record completed quests for now, get details later
                for (const questRef of completedQuests) {
                    if (!seenQuests.has(questRef.id)) {
                        seenQuests.add(questRef.id);
                        await database.upsertCompletedQuest(userId, questRef.id);
                    }
                }

            } catch (charErr) {
                console.error(`Failed to get quests for ${character.name}:`, charErr.message);
            }
        }

        console.log(`Phase 2: Random quest discovery sampling...`);

        // Trigger background quest discovery (non-blocking)
        setImmediate(() => {
            backgroundQuestDiscovery(userRegion, accessToken)
                .catch(error => console.error('Background quest discovery error:', error));
        });

        // For immediate user feedback, do a quick sample of a few quests
        const quickSampleCount = 20;
        for (let i = 0; i < quickSampleCount; i++) {
            try {
                // Random quest ID sampling
                const randomId = Math.floor(Math.random() * 80000) + 1;

                if (!seenQuests.has(randomId)) {
                    const questDetails = await fetchQuestDetails(userRegion, randomId, accessToken);

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
                        processed++;
                    }

                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (questErr) {
                failed++;
            }
        }

        console.log(`Quick sampling complete. Background discovery running...`);

        // Update quest sync time
        await database.updateQuestSyncTime(userId);

        console.log('Quest cache population completed');
        res.json({
            message: 'Quest cache populated successfully from character data',
            results: {
                areas: 0, // Quest Index APIs not available
                categories: 0, // Quest Index APIs not available
                types: 0, // Quest Index APIs not available
                questsProcessed: processed,
                questsFailed: failed,
                totalQuests: processed + failed,
                charactersProcessed: characters.length
            }
        });

    } catch (error) {
        console.error('Quest cache population error:', error);
        res.status(500).json({
            error: 'Failed to populate quest cache',
            details: error.message
        });
    }
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
        console.log('🗃️  Database initialized successfully');

        // Start periodic quest discovery service
        await startPeriodicQuestDiscovery();
        console.log('🔍 Background quest discovery service started');

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