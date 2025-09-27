const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Initialization lock to prevent concurrent database initialization
let initializationLock = false;

// Create connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Test connection and log any issues
pool.on('connect', () => {
    console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('❌ PostgreSQL connection error:', err);
});

// WoW expansion tier order mapping (oldest to newest)
function getTierOrder(tierName) {
    if (!tierName) return 999;

    const tierOrderMap = {
        // Classic
        'Classic': 0,
        'Vanilla': 0,

        // Burning Crusade
        'Outland': 1,
        'The Burning Crusade': 1,
        'TBC': 1,

        // Wrath of the Lich King
        'Northrend': 2,
        'Wrath of the Lich King': 2,
        'WotLK': 2,

        // Cataclysm
        'Cataclysm': 3,

        // Mists of Pandaria
        'Pandaria': 4,
        'Mists of Pandaria': 4,
        'MoP': 4,

        // Warlords of Draenor
        'Draenor': 5,
        'Warlords of Draenor': 5,
        'WoD': 5,

        // Legion
        'Legion': 6,
        'Broken Isles': 6,

        // Battle for Azeroth
        'Battle for Azeroth': 7,
        'BfA': 7,
        'Kul Tiran': 7,
        'Zandalari': 7,

        // Shadowlands
        'Shadowlands': 8,

        // Dragonflight
        'Dragon Isles': 9,
        'Dragonflight': 9,

        // The War Within (current)
        'Khaz Algar': 10,
        'The War Within': 10
    };

    // Check for exact matches first
    if (tierOrderMap.hasOwnProperty(tierName)) {
        return tierOrderMap[tierName];
    }

    // Check for partial matches (case-insensitive)
    const lowerTierName = tierName.toLowerCase();
    for (const [key, value] of Object.entries(tierOrderMap)) {
        if (lowerTierName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerTierName)) {
            return value;
        }
    }

    // If no match found, return a high number so it appears last
    return 999;
}

// Initialize database schema with multi-user support
async function initDatabase() {
    // Prevent concurrent initialization
    if (initializationLock) {
        console.log('⏳ Database initialization already in progress, skipping...');
        return;
    }

    initializationLock = true;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                battlenet_id TEXT UNIQUE NOT NULL,
                battlenet_tag TEXT,
                email TEXT,
                region TEXT DEFAULT 'us',
                last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                quest_sync_time TIMESTAMP DEFAULT NULL
            )
        `);

        // Characters table with user association
        await client.query(`
            CREATE TABLE IF NOT EXISTS characters (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                realm TEXT NOT NULL,
                level INTEGER,
                class TEXT,
                race TEXT,
                faction TEXT,
                average_item_level INTEGER,
                equipped_item_level INTEGER,
                title TEXT,
                guild TEXT,
                active_spec TEXT,
                covenant TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, name, realm)
            )
        `);

        // Professions table with user association
        await client.query(`
            CREATE TABLE IF NOT EXISTS professions (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                character_id TEXT NOT NULL,
                profession_name TEXT NOT NULL,
                profession_id INTEGER,
                tier_name TEXT,
                tier_id INTEGER,
                skill_level INTEGER,
                max_skill_level INTEGER,
                recipes_known INTEGER,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (character_id) REFERENCES characters(id),
                UNIQUE(character_id, profession_name, tier_name)
            )
        `);

        // Character notes table with user association
        await client.query(`
            CREATE TABLE IF NOT EXISTS character_notes (
                character_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                notes TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (character_id) REFERENCES characters(id)
            )
        `);

        // Session table for secure session management
        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                access_token TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // Recipe cache for missing recipe analysis
        await client.query(`
            CREATE TABLE IF NOT EXISTS cached_recipes (
                id SERIAL PRIMARY KEY,
                profession_id INTEGER NOT NULL,
                profession_name TEXT NOT NULL,
                tier_id INTEGER NOT NULL,
                tier_name TEXT NOT NULL,
                category_name TEXT,
                recipe_id INTEGER NOT NULL,
                recipe_name TEXT NOT NULL,
                cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(profession_id, tier_id, recipe_id)
            )
        `);

        // Known recipes per character
        await client.query(`
            CREATE TABLE IF NOT EXISTS character_known_recipes (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                character_id TEXT NOT NULL,
                profession_id INTEGER NOT NULL,
                tier_id INTEGER NOT NULL,
                recipe_id INTEGER NOT NULL,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (character_id) REFERENCES characters(id),
                UNIQUE(character_id, profession_id, tier_id, recipe_id)
            )
        `);

        // Class/Race/Faction combinations per user
        await client.query(`
            CREATE TABLE IF NOT EXISTS character_combinations (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                class TEXT NOT NULL,
                race TEXT NOT NULL,
                faction TEXT NOT NULL,
                character_id TEXT,
                character_name TEXT,
                character_level INTEGER,
                has_character BOOLEAN DEFAULT FALSE,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, class, race, faction)
            )
        `);

        // Quest tracking tables - comprehensive quest database
        await client.query(`
            CREATE TABLE IF NOT EXISTS quest_master_cache (
                id SERIAL PRIMARY KEY,
                quest_id INTEGER UNIQUE NOT NULL,
                quest_name TEXT NOT NULL,
                area_id INTEGER,
                area_name TEXT,
                category_id INTEGER,
                category_name TEXT,
                type_id INTEGER,
                type_name TEXT,
                expansion_name TEXT,
                is_seasonal BOOLEAN DEFAULT FALSE,
                cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Quest metadata tables
        await client.query(`
            CREATE TABLE IF NOT EXISTS quest_areas (
                id SERIAL PRIMARY KEY,
                area_id INTEGER UNIQUE NOT NULL,
                area_name TEXT NOT NULL,
                cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS quest_categories (
                id SERIAL PRIMARY KEY,
                category_id INTEGER UNIQUE NOT NULL,
                category_name TEXT NOT NULL,
                cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS quest_types (
                id SERIAL PRIMARY KEY,
                type_id INTEGER UNIQUE NOT NULL,
                type_name TEXT NOT NULL,
                cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS warband_completed_quests (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                quest_id INTEGER NOT NULL,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, quest_id)
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS zone_quest_summary (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                zone_name TEXT NOT NULL,
                expansion_name TEXT NOT NULL,
                total_quests INTEGER NOT NULL,
                completed_quests INTEGER NOT NULL,
                completion_percentage DECIMAL(5,2) NOT NULL,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, zone_name, expansion_name)
            )
        `);

        // Migrations for existing databases
        // Add quest_sync_time column to users table if it doesn't exist
        try {
            await client.query(`
                ALTER TABLE users ADD COLUMN quest_sync_time TIMESTAMP DEFAULT NULL
            `);
            console.log('✅ Added quest_sync_time column to users table');
        } catch (error) {
            if (error.code === '42701') {
                // Column already exists, ignore
                // console.log('✅ quest_sync_time column already exists in users table');
            } else {
                console.log('⚠️ Error adding quest_sync_time column:', error.message);
            }
        }

        await client.query('COMMIT');
        console.log('✅ Database tables initialized successfully');

        // Auction House Integration Tables - separate transaction
        await client.query('BEGIN');

        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS auction_prices (
                    id SERIAL PRIMARY KEY,
                    connected_realm_id INTEGER NOT NULL,
                    item_id INTEGER NOT NULL,
                    price BIGINT NOT NULL,
                    quantity INTEGER NOT NULL,
                    time_left VARCHAR(20),
                    region TEXT DEFAULT 'us',
                    snapshot_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            // console.log('✅ auction_prices table created/verified');
        } catch (error) {
            console.log('⚠️ Error creating auction_prices table:', error.message);
        }

        try {
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_auction_prices_realm_item_time
                ON auction_prices(connected_realm_id, item_id, snapshot_time)
            `);
            console.log('✅ auction_prices indexes created/verified');
        } catch (error) {
            console.log('⚠️ Error creating auction_prices indexes:', error.message);
        }

        try {
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_auction_prices_item_time
                ON auction_prices(item_id, snapshot_time)
            `);
        } catch (error) {
            console.log('⚠️ Error creating auction_prices item index:', error.message);
        }

        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS current_auctions (
                    connected_realm_id INTEGER NOT NULL,
                    item_id INTEGER NOT NULL,
                    lowest_price BIGINT NOT NULL,
                    avg_price BIGINT,
                    total_quantity INTEGER,
                    auction_count INTEGER,
                    region TEXT DEFAULT 'us',
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(connected_realm_id, item_id, region)
                )
            `);
            // console.log('✅ current_auctions table created/verified');
        } catch (error) {
            console.log('⚠️ Error creating current_auctions table:', error.message);
        }

        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS profession_mains (
                    user_id TEXT NOT NULL,
                    profession_name VARCHAR(50) NOT NULL,
                    character_id TEXT NOT NULL,
                    priority INTEGER DEFAULT 1,
                    assigned_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(user_id, profession_name, priority),
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (character_id) REFERENCES characters(id)
                )
            `);
            // console.log('✅ profession_mains table created/verified');
        } catch (error) {
            console.log('⚠️ Error creating profession_mains table:', error.message);
        }

        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS price_alerts (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    item_id INTEGER NOT NULL,
                    target_price BIGINT NOT NULL,
                    connected_realm_id INTEGER NOT NULL,
                    is_active BOOLEAN DEFAULT true,
                    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    triggered_date TIMESTAMP NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `);
            // console.log('✅ price_alerts table created/verified');
        } catch (error) {
            console.log('⚠️ Error creating price_alerts table:', error.message);
        }

        // Collection Analytics Tables
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS collection_snapshots (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    subcategory VARCHAR(100),
                    total_possible INTEGER NOT NULL,
                    total_collected INTEGER NOT NULL,
                    completion_percentage DECIMAL(5,2) NOT NULL,
                    snapshot_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    metadata JSONB,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `);
            // console.log('✅ collection_snapshots table created/verified');
        } catch (error) {
            console.log('⚠️ Error creating collection_snapshots table:', error.message);
        }

        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS collection_velocity (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    subcategory VARCHAR(100),
                    timeframe VARCHAR(20) NOT NULL,
                    items_gained INTEGER NOT NULL,
                    velocity_per_day DECIMAL(10,4) NOT NULL,
                    period_start TIMESTAMP NOT NULL,
                    period_end TIMESTAMP NOT NULL,
                    calculated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `);
            // console.log('✅ collection_velocity table created/verified');
        } catch (error) {
            console.log('⚠️ Error creating collection_velocity table:', error.message);
        }

        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS completion_projections (
                    id SERIAL PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    subcategory VARCHAR(100),
                    current_completion DECIMAL(5,2) NOT NULL,
                    target_completion DECIMAL(5,2) NOT NULL,
                    estimated_days INTEGER,
                    estimated_completion_date TIMESTAMP,
                    confidence_level DECIMAL(3,2),
                    projection_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id)
                )
            `);
            // console.log('✅ completion_projections table created/verified');
        } catch (error) {
            console.log('⚠️ Error creating completion_projections table:', error.message);
        }
        // Focus on real-time auction data only

        // Create connected realms mapping table
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS connected_realms (
                    id SERIAL PRIMARY KEY,
                    connected_realm_id INTEGER NOT NULL,
                    realm_slug TEXT NOT NULL,
                    realm_name TEXT NOT NULL,
                    region TEXT NOT NULL,
                    locale TEXT,
                    timezone TEXT,
                    population TEXT,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(connected_realm_id, realm_slug, region)
                )
            `);
            // console.log('✅ connected_realms table created/verified');
        } catch (error) {
            console.log('⚠️ Error creating connected_realms table:', error.message);
        }

        await client.query('COMMIT');
        console.log('📊 PostgreSQL database initialized successfully');

        // Run migrations after table creation
        await runMigrations(client);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        initializationLock = false; // Reset lock when done
    }
}

// Database helper functions with user context
const dbHelpers = {
    // User management
    findOrCreateUser: async function(battlenetId, battlenetTag, email = null) {
        const client = await pool.connect();
        try {
            const userId = `user_${battlenetId}`;

            const userResult = await client.query(
                'SELECT * FROM users WHERE battlenet_id = $1',
                [battlenetId]
            );

            if (userResult.rows.length > 0) {
                // Update last login
                await client.query(
                    'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1',
                    [userResult.rows[0].id]
                );
                return userResult.rows[0];
            }

            // Create new user
            const insertResult = await client.query(
                'INSERT INTO users (id, battlenet_id, battlenet_tag, email) VALUES ($1, $2, $3, $4) RETURNING *',
                [userId, battlenetId, battlenetTag, email]
            );

            return insertResult.rows[0];
        } finally {
            client.release();
        }
    },

    // Update or insert character for specific user
    upsertCharacter: async function(userId, character) {
        const client = await pool.connect();
        try {
            // Serialize title data as JSON if it's an object
            const titleData = character.title ? JSON.stringify(character.title) : null;

            await client.query(`
                INSERT INTO characters
                (id, user_id, name, realm, level, class, race, faction, average_item_level, equipped_item_level, title, guild, active_spec, covenant, last_updated)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    realm = EXCLUDED.realm,
                    level = EXCLUDED.level,
                    class = EXCLUDED.class,
                    race = EXCLUDED.race,
                    faction = EXCLUDED.faction,
                    average_item_level = EXCLUDED.average_item_level,
                    equipped_item_level = EXCLUDED.equipped_item_level,
                    title = EXCLUDED.title,
                    guild = EXCLUDED.guild,
                    active_spec = EXCLUDED.active_spec,
                    covenant = EXCLUDED.covenant,
                    last_updated = CURRENT_TIMESTAMP
            `, [
                character.id,
                userId,
                character.name,
                character.realm,
                character.level,
                character.class,
                character.race,
                character.faction,
                character.averageItemLevel,
                character.equippedItemLevel,
                titleData,
                character.guild,
                character.activeSpec,
                character.covenant
            ]);
        } finally {
            client.release();
        }
    },

    // Update or insert profession for specific user
    upsertProfessionTier: async function(userId, characterId, professionName, professionId, tier) {
        const client = await pool.connect();
        try {
            // First check if character exists
            const charCheck = await client.query(
                'SELECT id FROM characters WHERE id = $1 AND user_id = $2',
                [characterId, userId]
            );

            if (charCheck.rows.length === 0) {
                console.warn(`Character ${characterId} not found for user ${userId}, skipping profession ${professionName}`);
                return;
            }

            await client.query(`
                INSERT INTO professions
                (user_id, character_id, profession_name, profession_id, tier_name, tier_id,
                 skill_level, max_skill_level, recipes_known, last_updated)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
                ON CONFLICT (character_id, profession_name, tier_name) DO UPDATE SET
                    profession_id = EXCLUDED.profession_id,
                    tier_id = EXCLUDED.tier_id,
                    skill_level = EXCLUDED.skill_level,
                    max_skill_level = EXCLUDED.max_skill_level,
                    recipes_known = EXCLUDED.recipes_known,
                    last_updated = CURRENT_TIMESTAMP
            `, [
                userId,
                characterId,
                professionName,
                professionId,
                tier.name,
                tier.id || null,
                tier.skillLevel,
                tier.maxSkill,
                tier.recipes || 0
            ]);
        } finally {
            client.release();
        }
    },

    // Get all characters for a specific user
    getAllCharacters: async function(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT c.*,
                STRING_AGG(DISTINCT p.profession_name, ', ') as professions_list
                FROM characters c
                LEFT JOIN professions p ON c.id = p.character_id
                WHERE c.user_id = $1
                GROUP BY c.id
                ORDER BY c.average_item_level DESC
            `, [userId]);

            return result.rows;
        } finally {
            client.release();
        }
    },

    // Get character with professions for specific user
    getCharacterWithProfessions: async function(userId, characterId) {
        const client = await pool.connect();
        try {
            const charResult = await client.query(
                'SELECT * FROM characters WHERE id = $1 AND user_id = $2',
                [characterId, userId]
            );

            if (charResult.rows.length === 0) {
                return null;
            }

            const profResult = await client.query(
                'SELECT * FROM professions WHERE character_id = $1 AND user_id = $2',
                [characterId, userId]
            );

            return {
                info: charResult.rows[0],
                professions: profResult.rows
            };
        } finally {
            client.release();
        }
    },

    // Save character notes for specific user
    saveNotes: async function(userId, characterId, notes) {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO character_notes (character_id, user_id, notes, last_updated)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (character_id) DO UPDATE SET
                    notes = EXCLUDED.notes,
                    last_updated = CURRENT_TIMESTAMP
            `, [characterId, userId, notes]);
        } finally {
            client.release();
        }
    },

    // Get character notes for specific user
    getNotes: async function(userId, characterId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT notes FROM character_notes WHERE character_id = $1 AND user_id = $2',
                [characterId, userId]
            );

            return result.rows.length > 0 ? result.rows[0].notes : '';
        } finally {
            client.release();
        }
    },

    // Get all notes for a user's characters
    getAllNotes: async function(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT character_id, notes FROM character_notes WHERE user_id = $1 AND notes IS NOT NULL AND notes != \'\'',
                [userId]
            );

            const notesMap = {};
            result.rows.forEach(row => {
                notesMap[row.character_id] = row.notes;
            });
            return notesMap;
        } finally {
            client.release();
        }
    },

    // Get profession summary for specific user
    getProfessionSummary: async function(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT
                    p.profession_name,
                    p.tier_name,
                    COUNT(DISTINCT p.character_id)::integer as total_characters,
                    COUNT(CASE WHEN p.skill_level = p.max_skill_level THEN 1 END)::integer as maxed_characters,
                    STRING_AGG(
                        c.name || ' (' || p.skill_level || '/' || p.max_skill_level || ')',
                        ', '
                    ) as character_list
                FROM professions p
                JOIN characters c ON p.character_id = c.id
                WHERE p.user_id = $1
                GROUP BY p.profession_name, p.tier_name
                ORDER BY p.profession_name, p.tier_name
            `, [userId]);

            // Sort results by profession name and tier order (instead of alphabetical)
            const sortedRows = result.rows.sort((a, b) => {
                // First sort by profession name
                if (a.profession_name !== b.profession_name) {
                    return a.profession_name.localeCompare(b.profession_name);
                }
                // Then sort by expansion tier order
                return getTierOrder(a.tier_name) - getTierOrder(b.tier_name);
            });

            return sortedRows;
        } finally {
            client.release();
        }
    },

    // Update class/race/faction combinations for specific user
    updateCombinations: async function(userId, characters) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // First, mark all existing combinations for this user as not existing
            await client.query(
                'UPDATE character_combinations SET has_character = FALSE WHERE user_id = $1',
                [userId]
            );

            // Insert or update combinations for each character
            for (const char of characters) {
                await client.query(`
                    INSERT INTO character_combinations
                    (user_id, class, race, faction, character_id, character_name, character_level, has_character, last_updated)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, CURRENT_TIMESTAMP)
                    ON CONFLICT (user_id, class, race, faction) DO UPDATE SET
                        character_id = EXCLUDED.character_id,
                        character_name = EXCLUDED.character_name,
                        character_level = EXCLUDED.character_level,
                        has_character = TRUE,
                        last_updated = CURRENT_TIMESTAMP
                `, [
                    userId,
                    char.class,
                    char.race,
                    char.faction,
                    char.id,
                    char.name,
                    char.level
                ]);
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    // Get missing recipes for a character's profession tier
    getMissingRecipes: async function(professionId, tierId, knownRecipeIds = []) {
        const client = await pool.connect();
        try {
            let query = `
                SELECT * FROM cached_recipes
                WHERE profession_id = $1 AND tier_id = $2
            `;
            const params = [professionId, tierId];

            // Exclude known recipes if any provided
            if (knownRecipeIds.length > 0) {
                const placeholders = knownRecipeIds.map((_, i) => `$${i + 3}`).join(',');
                query += ` AND recipe_id NOT IN (${placeholders})`;
                params.push(...knownRecipeIds);
            }

            query += ` ORDER BY category_name, recipe_name`;

            const result = await client.query(query, params);
            return result.rows;
        } finally {
            client.release();
        }
    },

    // Check recipe cache status
    getRecipeCacheStatus: async function() {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT
                    COUNT(*) as total_recipes,
                    MAX(cached_at) as last_cached,
                    COUNT(DISTINCT profession_id) as cached_professions
                FROM cached_recipes
            `);

            return result.rows[0];
        } finally {
            client.release();
        }
    },

    // Store known recipes for a character
    upsertKnownRecipes: async function(userId, characterId, professionId, tierId, knownRecipeIds) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Clear existing known recipes for this character's profession tier
            await client.query(
                'DELETE FROM character_known_recipes WHERE character_id = $1 AND profession_id = $2 AND tier_id = $3',
                [characterId, professionId, tierId]
            );

            // Insert new known recipes
            for (const recipeId of knownRecipeIds) {
                await client.query(
                    'INSERT INTO character_known_recipes (user_id, character_id, profession_id, tier_id, recipe_id) VALUES ($1, $2, $3, $4, $5)',
                    [userId, characterId, professionId, tierId, recipeId]
                );
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    // Get known recipe IDs for a character's profession tier
    getKnownRecipeIds: async function(characterId, professionId, tierId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT recipe_id FROM character_known_recipes WHERE character_id = $1 AND profession_id = $2 AND tier_id = $3',
                [characterId, professionId, tierId]
            );

            return result.rows.map(row => row.recipe_id);
        } finally {
            client.release();
        }
    },

    // Get enhanced profession summary with recipe completion
    getEnhancedProfessionSummary: async function(userId) {
        const client = await pool.connect();
        try {
            // First check if we have cached recipe data
            const countResult = await client.query('SELECT COUNT(*) as count FROM cached_recipes');

            if (parseInt(countResult.rows[0].count) === 0) {
                // No recipe data, fall back to basic profession summary
                return await dbHelpers.getProfessionSummary(userId);
            }

            // We have recipe data, so do enhanced summary
            const result = await client.query(`
                WITH profession_tier_recipes AS (
                    SELECT DISTINCT
                        p.profession_name,
                        p.profession_id,
                        p.tier_name,
                        p.tier_id,
                        COUNT(DISTINCT p.character_id)::integer as total_characters,
                        STRING_AGG(
                            DISTINCT c.name || ' (' || p.skill_level || '/' || p.max_skill_level || ')', ', '
                        ) as character_list
                    FROM professions p
                    JOIN characters c ON p.character_id = c.id
                    WHERE p.user_id = $1
                    GROUP BY p.profession_name, p.profession_id, p.tier_name, p.tier_id
                ),
                recipe_stats AS (
                    SELECT
                        cr.profession_id,
                        cr.tier_id,
                        COUNT(DISTINCT cr.recipe_id) as total_recipes_available,
                        COUNT(DISTINCT ckr.recipe_id) as total_recipes_known
                    FROM cached_recipes cr
                    LEFT JOIN character_known_recipes ckr ON cr.recipe_id = ckr.recipe_id
                        AND ckr.user_id = $2
                    GROUP BY cr.profession_id, cr.tier_id
                )
                SELECT
                    ptr.*,
                    COALESCE(rs.total_recipes_available, 0)::integer as total_recipes_available,
                    COALESCE(rs.total_recipes_known, 0)::integer as total_recipes_known,
                    CAST(ROUND(
                        CASE
                            WHEN COALESCE(rs.total_recipes_available, 0) > 0
                            THEN (CAST(COALESCE(rs.total_recipes_known, 0) AS DECIMAL) / rs.total_recipes_available) * 100
                            ELSE 0
                        END, 1
                    ) AS DECIMAL) as completion_percentage
                FROM profession_tier_recipes ptr
                LEFT JOIN recipe_stats rs ON ptr.profession_id = rs.profession_id
                    AND ptr.tier_id = rs.tier_id
                ORDER BY ptr.profession_name, ptr.tier_name
            `, [userId, userId]);

            // Sort results by profession name and tier order (instead of alphabetical)
            const sortedRows = result.rows.sort((a, b) => {
                // First sort by profession name
                if (a.profession_name !== b.profession_name) {
                    return a.profession_name.localeCompare(b.profession_name);
                }
                // Then sort by expansion tier order
                return getTierOrder(a.tier_name) - getTierOrder(b.tier_name);
            });

            return sortedRows;
        } finally {
            client.release();
        }
    },

    // Get missing profession coverage (recipes that no character knows)
    getMissingProfessionCoverage: async function(userId) {
        const client = await pool.connect();
        try {
            // First check if we have any cached recipe data
            const countResult = await client.query('SELECT COUNT(*) as count FROM cached_recipes');

            if (parseInt(countResult.rows[0].count) === 0) {
                // No recipe data cached yet, return empty array
                return [];
            }

            // Find recipes that no character of this user knows
            const result = await client.query(`
                SELECT
                    cr.profession_name,
                    cr.profession_id,
                    cr.tier_name,
                    cr.tier_id,
                    COUNT(cr.recipe_id)::integer as missing_recipes,
                    STRING_AGG(cr.recipe_name, ', ') as missing_recipe_names,
                    STRING_AGG(cr.recipe_id::text, ', ') as missing_recipe_ids
                FROM cached_recipes cr
                WHERE NOT EXISTS (
                    SELECT 1 FROM character_known_recipes ckr
                    WHERE ckr.user_id = $1
                    AND ckr.recipe_id = cr.recipe_id
                )
                GROUP BY cr.profession_name, cr.profession_id, cr.tier_name, cr.tier_id
                HAVING COUNT(cr.recipe_id) > 0
                ORDER BY cr.profession_name, cr.tier_name
            `, [userId]);

            // Sort results by profession name and tier order (instead of alphabetical)
            const sortedRows = result.rows.sort((a, b) => {
                // First sort by profession name
                if (a.profession_name !== b.profession_name) {
                    return a.profession_name.localeCompare(b.profession_name);
                }
                // Then sort by expansion tier order
                return getTierOrder(a.tier_name) - getTierOrder(b.tier_name);
            });

            return sortedRows;
        } finally {
            client.release();
        }
    },

    // Get combination matrix for specific user
    getCombinationMatrix: async function(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT * FROM character_combinations
                WHERE user_id = $1 AND has_character = TRUE
                ORDER BY faction, class, race
            `, [userId]);

            return result.rows;
        } finally {
            client.release();
        }
    },

    // Session management
    createSession: async function(userId, accessToken, expiresIn = 7200) {
        const client = await pool.connect();
        try {
            const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const expiresAt = new Date(Date.now() + expiresIn * 1000);

            await client.query(
                'INSERT INTO sessions (id, user_id, access_token, expires_at) VALUES ($1, $2, $3, $4)',
                [sessionId, userId, accessToken, expiresAt]
            );

            return sessionId;
        } finally {
            client.release();
        }
    },

    // Clean up expired sessions
    cleanupSessions: async function() {
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP');
        } finally {
            client.release();
        }
    },

    // Cache recipes for a profession tier
    cacheRecipes: async function(professionId, professionName, tierData) {
        const client = await pool.connect();
        try {
            // Helper function to extract English text from localized objects
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

            await client.query('BEGIN');

            // Clear existing recipes for this profession tier
            await client.query(
                'DELETE FROM cached_recipes WHERE profession_id = $1 AND tier_id = $2',
                [professionId, tierData.id]
            );

            // Insert all recipes from all categories
            for (const category of tierData.categories || []) {
                const categoryName = extractEnglishText(category);
                for (const recipe of category.recipes || []) {
                    const recipeName = extractEnglishText(recipe);
                    await client.query(
                        'INSERT INTO cached_recipes (profession_id, profession_name, tier_id, tier_name, category_name, recipe_id, recipe_name) VALUES ($1, $2, $3, $4, $5, $6, $7)',
                        [
                            professionId,
                            professionName,
                            tierData.id,
                            tierData.name || extractEnglishText(tierData),
                            categoryName,
                            recipe.id,
                            recipeName
                        ]
                    );
                }
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    // Clear all cached recipes to fix corrupted data
    clearCachedRecipes: async function() {
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM cached_recipes');
            console.log('Cleared all cached recipes due to corrupted data');
        } finally {
            client.release();
        }
    },

    // Update user region
    updateUserRegion: async function(userId, region) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'UPDATE users SET region = $1 WHERE id = $2',
                [region, userId]
            );

            return { changes: result.rowCount };
        } finally {
            client.release();
        }
    },

    // Get user region
    getUserRegion: async function(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT region FROM users WHERE id = $1',
                [userId]
            );

            return result.rows.length > 0 ? result.rows[0].region : 'us';
        } finally {
            client.release();
        }
    },

    // Get professions for a specific character with recipe counts
    getCharacterProfessions: async function(userId, characterId) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT
                    p.profession_name,
                    p.profession_id,
                    p.tier_name,
                    p.tier_id,
                    p.skill_level,
                    p.max_skill_level,
                    COUNT(DISTINCT cr.recipe_id)::integer as total_recipes,
                    COUNT(DISTINCT ckr.recipe_id)::integer as known_recipes
                FROM professions p
                LEFT JOIN cached_recipes cr ON p.profession_id = cr.profession_id AND p.tier_id = cr.tier_id
                LEFT JOIN character_known_recipes ckr ON p.character_id = ckr.character_id
                    AND p.profession_id = ckr.profession_id AND p.tier_id = ckr.tier_id
                    AND cr.recipe_id = ckr.recipe_id
                WHERE p.user_id = $1 AND p.character_id = $2
                GROUP BY p.profession_name, p.profession_id, p.tier_name, p.tier_id, p.skill_level, p.max_skill_level
                ORDER BY p.profession_name, p.tier_name
            `, [userId, characterId]);

            // Sort results by profession name and tier order (instead of alphabetical)
            const sortedRows = result.rows.sort((a, b) => {
                // First sort by profession name
                if (a.profession_name !== b.profession_name) {
                    return a.profession_name.localeCompare(b.profession_name);
                }
                // Then sort by expansion tier order
                return getTierOrder(a.tier_name) - getTierOrder(b.tier_name);
            });

            return sortedRows;
        } finally {
            client.release();
        }
    },

    // Quest tracking functions
    cacheQuest: async function(questId, questName, zoneName, expansionName, category = null, isSeasonal = false) {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO cached_quests (quest_id, quest_name, zone_name, expansion_name, category, is_seasonal)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (quest_id) DO UPDATE SET
                    quest_name = EXCLUDED.quest_name,
                    zone_name = EXCLUDED.zone_name,
                    expansion_name = EXCLUDED.expansion_name,
                    category = EXCLUDED.category,
                    is_seasonal = EXCLUDED.is_seasonal,
                    cached_at = CURRENT_TIMESTAMP
            `, [questId, questName, zoneName, expansionName, category, isSeasonal]);
        } finally {
            client.release();
        }
    },

    upsertCompletedQuest: async function(userId, questId) {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO warband_completed_quests (user_id, quest_id)
                VALUES ($1, $2)
                ON CONFLICT (user_id, quest_id) DO UPDATE SET
                    last_updated = CURRENT_TIMESTAMP
            `, [userId, questId]);
        } finally {
            client.release();
        }
    },

    getZoneQuestSummary: async function(userId, expansionFilter = null) {
        const client = await pool.connect();
        try {
            let query = `
                SELECT
                    zone_name,
                    expansion_name,
                    total_quests,
                    completed_quests,
                    completion_percentage
                FROM zone_quest_summary
                WHERE user_id = $1
            `;
            const params = [userId];

            if (expansionFilter && expansionFilter !== 'all') {
                query += ` AND expansion_name = $2`;
                params.push(expansionFilter);
            }

            query += ` ORDER BY completed_quests DESC, total_quests DESC`;

            const result = await client.query(query, params);
            return result.rows;
        } finally {
            client.release();
        }
    },

    updateZoneQuestSummary: async function(userId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Clear existing summary for this user
            await client.query('DELETE FROM zone_quest_summary WHERE user_id = $1', [userId]);

            // Calculate new summary - group by zone only, use primary expansion based on quest count
            await client.query(`
                INSERT INTO zone_quest_summary (user_id, zone_name, expansion_name, total_quests, completed_quests, completion_percentage)
                WITH zone_expansion_counts AS (
                    SELECT
                        zone_name,
                        expansion_name,
                        COUNT(*) as quest_count,
                        ROW_NUMBER() OVER (PARTITION BY zone_name ORDER BY COUNT(*) DESC) as rn
                    FROM cached_quests
                    WHERE is_seasonal = FALSE
                    GROUP BY zone_name, expansion_name
                ),
                primary_expansions AS (
                    SELECT zone_name, expansion_name
                    FROM zone_expansion_counts
                    WHERE rn = 1
                )
                SELECT
                    $1 as user_id,
                    cq.zone_name,
                    pe.expansion_name,
                    COUNT(cq.quest_id)::integer as total_quests,
                    COUNT(wcq.quest_id)::integer as completed_quests,
                    ROUND(
                        CASE
                            WHEN COUNT(cq.quest_id) > 0
                            THEN (COUNT(wcq.quest_id)::DECIMAL / COUNT(cq.quest_id)) * 100
                            ELSE 0
                        END, 2
                    ) as completion_percentage
                FROM cached_quests cq
                LEFT JOIN warband_completed_quests wcq ON cq.quest_id = wcq.quest_id AND wcq.user_id = $1
                JOIN primary_expansions pe ON cq.zone_name = pe.zone_name
                WHERE cq.is_seasonal = FALSE
                GROUP BY cq.zone_name, pe.expansion_name
            `, [userId]);

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    getQuestCacheStatus: async function() {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT
                    COUNT(*)::integer as total_quests,
                    MAX(cached_at) as last_cached,
                    COUNT(DISTINCT zone_name)::integer as cached_zones,
                    COUNT(DISTINCT expansion_name)::integer as cached_expansions
                FROM cached_quests
            `);
            return result.rows[0];
        } finally {
            client.release();
        }
    },

    clearQuestCache: async function() {
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM cached_quests');
            console.log('Cleared quest cache');
        } finally {
            client.release();
        }
    },

    // Quest sync time tracking
    getLastQuestSyncTime: async function(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT quest_sync_time FROM users WHERE id = $1',
                [userId]
            );
            return result.rows[0]?.quest_sync_time || null;
        } finally {
            client.release();
        }
    },

    updateQuestSyncTime: async function(userId) {
        const client = await pool.connect();
        try {
            await client.query(
                'UPDATE users SET quest_sync_time = CURRENT_TIMESTAMP WHERE id = $1',
                [userId]
            );
        } finally {
            client.release();
        }
    },

    // Quest Master Cache functions
    upsertQuestArea: async function(areaId, areaName) {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO quest_areas (area_id, area_name)
                VALUES ($1, $2)
                ON CONFLICT (area_id)
                DO UPDATE SET area_name = EXCLUDED.area_name, cached_at = CURRENT_TIMESTAMP
            `, [areaId, areaName]);
        } finally {
            client.release();
        }
    },

    upsertQuestCategory: async function(categoryId, categoryName) {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO quest_categories (category_id, category_name)
                VALUES ($1, $2)
                ON CONFLICT (category_id)
                DO UPDATE SET category_name = EXCLUDED.category_name, cached_at = CURRENT_TIMESTAMP
            `, [categoryId, categoryName]);
        } finally {
            client.release();
        }
    },

    upsertQuestType: async function(typeId, typeName) {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO quest_types (type_id, type_name)
                VALUES ($1, $2)
                ON CONFLICT (type_id)
                DO UPDATE SET type_name = EXCLUDED.type_name, cached_at = CURRENT_TIMESTAMP
            `, [typeId, typeName]);
        } finally {
            client.release();
        }
    },

    upsertQuestMaster: async function(questData) {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO quest_master_cache (
                    quest_id, quest_name, area_id, area_name, category_id, category_name,
                    type_id, type_name, expansion_name, is_seasonal
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (quest_id)
                DO UPDATE SET
                    quest_name = EXCLUDED.quest_name,
                    area_id = EXCLUDED.area_id,
                    area_name = EXCLUDED.area_name,
                    category_id = EXCLUDED.category_id,
                    category_name = EXCLUDED.category_name,
                    type_id = EXCLUDED.type_id,
                    type_name = EXCLUDED.type_name,
                    expansion_name = EXCLUDED.expansion_name,
                    is_seasonal = EXCLUDED.is_seasonal,
                    last_updated = CURRENT_TIMESTAMP
            `, [
                questData.quest_id,
                questData.quest_name,
                questData.area_id,
                questData.area_name,
                questData.category_id,
                questData.category_name,
                questData.type_id,
                questData.type_name,
                questData.expansion_name,
                questData.is_seasonal
            ]);
        } finally {
            client.release();
        }
    },

    getIncompleteQuestsByZone: async function(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                WITH zone_primary_expansion AS (
                    SELECT
                        area_name,
                        area_id,
                        expansion_name,
                        ROW_NUMBER() OVER (PARTITION BY area_name ORDER BY COUNT(*) DESC) as rn
                    FROM quest_master_cache
                    WHERE area_name IS NOT NULL AND area_name != ''
                    GROUP BY area_name, area_id, expansion_name
                )
                SELECT
                    q.area_name as zone_name,
                    zpe.area_id,
                    zpe.expansion_name,
                    COUNT(q.quest_id) as total_quests,
                    COUNT(wq.quest_id) as completed_quests,
                    COUNT(q.quest_id) - COUNT(wq.quest_id) as incomplete_quests,
                    ROUND((COUNT(wq.quest_id)::decimal / COUNT(q.quest_id)) * 100, 2) as completion_percentage
                FROM quest_master_cache q
                LEFT JOIN warband_completed_quests wq ON q.quest_id = wq.quest_id AND wq.user_id = $1
                JOIN zone_primary_expansion zpe ON q.area_name = zpe.area_name AND zpe.rn = 1
                WHERE q.area_name IS NOT NULL AND q.area_name != ''
                GROUP BY q.area_name, zpe.area_id, zpe.expansion_name
                HAVING COUNT(q.quest_id) - COUNT(wq.quest_id) > 0
                ORDER BY incomplete_quests DESC, q.area_name
            `, [userId]);

            return result.rows;
        } finally {
            client.release();
        }
    },

    getQuestFromMaster: async function(questId) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                'SELECT * FROM quest_master_cache WHERE quest_id = $1',
                [questId]
            );
            return result.rows[0] || null;
        } finally {
            client.release();
        }
    },

    getIncompleteQuestDetailsForZone: async function(userId, zoneName) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT
                    q.quest_id,
                    q.quest_name,
                    q.area_name as zone_name,
                    q.expansion_name,
                    q.type_name as quest_type,
                    q.is_seasonal
                FROM quest_master_cache q
                LEFT JOIN warband_completed_quests wq ON q.quest_id = wq.quest_id AND wq.user_id = $1
                WHERE q.area_name = $2
                  AND wq.quest_id IS NULL
                  AND q.quest_name IS NOT NULL
                  AND q.quest_name != ''
                ORDER BY q.quest_name
            `, [userId, zoneName]);

            return result.rows;
        } finally {
            client.release();
        }
    },

    clearQuestMasterCache: async function() {
        const client = await pool.connect();
        try {
            await client.query('DELETE FROM quest_master_cache');
            await client.query('DELETE FROM quest_areas');
            await client.query('DELETE FROM quest_categories');
            await client.query('DELETE FROM quest_types');
            console.log('Cleared quest master cache');
        } finally {
            client.release();
        }
    },

    cleanupJsonZoneNames: async function() {
        const client = await pool.connect();
        try {
            console.log('Starting zone name cleanup...');

            // Find all records with JSON-formatted area names
            const jsonRecords = await client.query(`
                SELECT id, area_name
                FROM quest_master_cache
                WHERE area_name LIKE '{"en_US"%'
            `);

            console.log(`Found ${jsonRecords.rows.length} records with JSON area names`);

            let updated = 0;
            for (const record of jsonRecords.rows) {
                try {
                    const jsonData = JSON.parse(record.area_name);
                    const englishName = jsonData.en_US || jsonData.en_GB;

                    if (englishName) {
                        await client.query(`
                            UPDATE quest_master_cache
                            SET area_name = $1, last_updated = CURRENT_TIMESTAMP
                            WHERE id = $2
                        `, [englishName, record.id]);
                        updated++;
                    }
                } catch (parseError) {
                    console.log(`Failed to parse JSON for record ${record.id}:`, parseError.message);
                }
            }

            console.log(`✅ Updated ${updated} zone names from JSON to English text`);
            return { processed: jsonRecords.rows.length, updated };
        } finally {
            client.release();
        }
    },

    // Auction House Functions
    upsertAuctionData: async function(connectedRealmId, auctionData, region = 'us') {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Process auction data and insert current auctions
            const itemPrices = new Map();

            for (const auction of auctionData) {
                const itemId = auction.item.id;
                const price = auction.buyout || auction.bid || 0;
                const quantity = auction.quantity || 1;

                if (price === 0) continue; // Skip auctions without prices

                if (!itemPrices.has(itemId)) {
                    itemPrices.set(itemId, {
                        prices: [],
                        totalQuantity: 0,
                        auctionCount: 0
                    });
                }

                const itemData = itemPrices.get(itemId);
                itemData.prices.push(price);
                itemData.totalQuantity += quantity;
                itemData.auctionCount += 1;

                // Skip individual price history inserts for performance
                // We'll aggregate this data later with the daily aggregation function
            }


            // Process in batches to avoid PostgreSQL parameter limits
            // PostgreSQL limit is ~65,535 parameters, so we can safely do ~5,000 rows × 8 params = 40,000 params
            const batchSize = 5000; // Conservative batch size to avoid parameter limit issues
            const itemPricesArray = Array.from(itemPrices);
            let totalInserted = 0;

            for (let i = 0; i < itemPricesArray.length; i += batchSize) {
                const batch = itemPricesArray.slice(i, i + batchSize);
                const insertValues = [];
                const placeholders = [];
                let paramIndex = 1;

                for (const [itemId, data] of batch) {
                    const lowestPrice = Math.min(...data.prices);
                    const avgPrice = Math.round(data.prices.reduce((a, b) => a + b, 0) / data.prices.length);

                    // Add each parameter individually to the flat array
                    insertValues.push(
                        connectedRealmId, itemId, lowestPrice, avgPrice,
                        data.totalQuantity, data.auctionCount, region, new Date()
                    );

                    placeholders.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, $${paramIndex+4}, $${paramIndex+5}, $${paramIndex+6}, $${paramIndex+7})`);
                    paramIndex += 8;
                }

                // Batch INSERT
                if (batch.length > 0) {

                    await client.query(`
                        INSERT INTO current_auctions
                        (connected_realm_id, item_id, lowest_price, avg_price, total_quantity, auction_count, region, last_updated)
                        VALUES ${placeholders.join(', ')}
                        ON CONFLICT (connected_realm_id, item_id, region)
                        DO UPDATE SET
                            lowest_price = EXCLUDED.lowest_price,
                            avg_price = EXCLUDED.avg_price,
                            total_quantity = EXCLUDED.total_quantity,
                            auction_count = EXCLUDED.auction_count,
                            last_updated = EXCLUDED.last_updated
                    `, insertValues);

                }
            }

            await client.query('COMMIT');
            return { itemsProcessed: itemPrices.size, auctionsProcessed: auctionData.length };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    getCurrentAuctionPrices: async function(connectedRealmId, itemIds, region) {
        const client = await pool.connect();
        try {
            // Get prices from both realm-specific auctions and regional commodities
            const result = await client.query(`
                SELECT item_id, lowest_price, avg_price, total_quantity, auction_count, last_updated,
                       CASE WHEN connected_realm_id = 0 THEN 'commodity' ELSE 'realm' END as auction_type
                FROM current_auctions
                WHERE (connected_realm_id = $1 OR connected_realm_id = 0)
                AND region = $2
                AND item_id = ANY($3)
                ORDER BY connected_realm_id DESC -- Prefer realm-specific over commodities if both exist
            `, [connectedRealmId, region, itemIds]);

            // Remove duplicates, preferring realm-specific prices over commodities
            const uniquePrices = new Map();
            result.rows.forEach(row => {
                if (!uniquePrices.has(row.item_id)) {
                    uniquePrices.set(row.item_id, row);
                }
            });

            return Array.from(uniquePrices.values());
        } finally {
            client.release();
        }
    },

    // Get current auction price for a single item
    getCurrentAuctionPrice: async function(itemId, connectedRealmId) {
        const client = await pool.connect();
        try {
            // Get price from both realm-specific auctions and regional commodities
            const result = await client.query(`
                SELECT item_id, lowest_price, avg_price, total_quantity, auction_count,
                       last_updated, connected_realm_id,
                       CASE WHEN connected_realm_id = 0 THEN 'commodity' ELSE 'realm' END as auction_type
                FROM current_auctions
                WHERE (connected_realm_id = $1 OR connected_realm_id = 0)
                AND item_id = $2
                ORDER BY connected_realm_id DESC -- Prefer realm-specific over commodities if both exist
                LIMIT 1
            `, [connectedRealmId, itemId]);

            return result.rows.length > 0 ? result.rows[0] : null;
        } finally {
            client.release();
        }
    },

    getRecipeCostAnalysis: async function(userId, connectedRealmId, professionName) {
        const client = await pool.connect();
        try {
            // Get missing recipes for the user
            const result = await client.query(`
                WITH missing_recipes AS (
                    SELECT DISTINCT cr.recipe_id, cr.recipe_name
                    FROM cached_recipes cr
                    WHERE cr.profession_name = $1
                    AND NOT EXISTS (
                        SELECT 1 FROM character_known_recipes ckr
                        WHERE ckr.user_id = $2 AND ckr.recipe_id = cr.recipe_id
                    )
                )
                SELECT
                    mr.recipe_id,
                    mr.recipe_name,
                    ca.lowest_price,
                    ca.avg_price,
                    ca.total_quantity,
                    ca.auction_count,
                    ca.last_updated
                FROM missing_recipes mr
                LEFT JOIN current_auctions ca ON mr.recipe_id = ca.item_id AND ca.connected_realm_id = $3
                ORDER BY ca.lowest_price ASC NULLS LAST
            `, [professionName, userId, connectedRealmId]);

            return result.rows;
        } finally {
            client.release();
        }
    },

    setProfessionMain: async function(userId, professionName, characterId, priority = 1) {
        const client = await pool.connect();
        try {
            await client.query(`
                INSERT INTO profession_mains (user_id, profession_name, character_id, priority)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (user_id, profession_name, priority)
                DO UPDATE SET character_id = $3, assigned_date = CURRENT_TIMESTAMP
            `, [userId, professionName, characterId, priority]);
        } finally {
            client.release();
        }
    },

    getProfessionMains: async function(userId) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT pm.profession_name, pm.character_id, pm.priority, pm.assigned_date,
                       c.name as character_name, c.realm, c.level
                FROM profession_mains pm
                JOIN characters c ON pm.character_id = c.id
                WHERE pm.user_id = $1
                ORDER BY pm.profession_name, pm.priority
            `, [userId]);

            return result.rows;
        } finally {
            client.release();
        }
    },

    // Collection Analytics Functions
    createCollectionSnapshot: async function(userId, category, subcategory, totalPossible, totalCollected, metadata = null) {
        const client = await pool.connect();
        try {
            const completionPercentage = totalPossible > 0 ? (totalCollected / totalPossible * 100) : 0;

            const result = await client.query(`
                INSERT INTO collection_snapshots
                (user_id, category, subcategory, total_possible, total_collected, completion_percentage, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [userId, category, subcategory, totalPossible, totalCollected, completionPercentage, metadata]);

            return result.rows[0].id;
        } finally {
            client.release();
        }
    },

    getCollectionHistory: async function(userId, category, subcategory = null, daysBack = 30) {
        const client = await pool.connect();
        try {
            const query = subcategory
                ? `SELECT * FROM collection_snapshots
                   WHERE user_id = $1 AND category = $2 AND subcategory = $3
                   AND snapshot_date > CURRENT_TIMESTAMP - INTERVAL '${daysBack} days'
                   ORDER BY snapshot_date ASC`
                : `SELECT * FROM collection_snapshots
                   WHERE user_id = $1 AND category = $2
                   AND snapshot_date > CURRENT_TIMESTAMP - INTERVAL '${daysBack} days'
                   ORDER BY snapshot_date ASC`;

            const params = subcategory ? [userId, category, subcategory] : [userId, category];
            const result = await client.query(query, params);

            return result.rows;
        } finally {
            client.release();
        }
    },

    calculateCollectionVelocity: async function(userId, category, subcategory = null, timeframeDays = 7) {
        const client = await pool.connect();
        try {
            // Get snapshots for the specified timeframe
            const snapshots = await this.getCollectionHistory(userId, category, subcategory, timeframeDays * 2);

            if (snapshots.length < 2) {
                return null; // Not enough data for velocity calculation
            }

            const latest = snapshots[snapshots.length - 1];
            const earliest = snapshots[0];

            const daysDifference = (new Date(latest.snapshot_date) - new Date(earliest.snapshot_date)) / (1000 * 60 * 60 * 24);
            const itemsGained = latest.total_collected - earliest.total_collected;
            const velocityPerDay = daysDifference > 0 ? itemsGained / daysDifference : 0;

            // Store velocity calculation
            await client.query(`
                INSERT INTO collection_velocity
                (user_id, category, subcategory, timeframe, items_gained, velocity_per_day, period_start, period_end)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [userId, category, subcategory, `${timeframeDays}d`, itemsGained, velocityPerDay, earliest.snapshot_date, latest.snapshot_date]);

            return {
                itemsGained,
                velocityPerDay,
                timeframeDays,
                periodStart: earliest.snapshot_date,
                periodEnd: latest.snapshot_date
            };
        } finally {
            client.release();
        }
    },

    generateCompletionProjection: async function(userId, category, subcategory = null, targetCompletion = 100) {
        const client = await pool.connect();
        try {
            // Get recent velocity data
            const velocity = await this.calculateCollectionVelocity(userId, category, subcategory, 14); // 2 week velocity

            if (!velocity || velocity.velocityPerDay <= 0) {
                return null; // No progress or insufficient data
            }

            // Get current completion
            const snapshots = await this.getCollectionHistory(userId, category, subcategory, 7);
            if (snapshots.length === 0) return null;

            const current = snapshots[snapshots.length - 1];
            const remainingItems = (current.total_possible * targetCompletion / 100) - current.total_collected;

            if (remainingItems <= 0) {
                return { alreadyComplete: true, currentCompletion: current.completion_percentage };
            }

            const estimatedDays = Math.ceil(remainingItems / velocity.velocityPerDay);
            const estimatedCompletionDate = new Date();
            estimatedCompletionDate.setDate(estimatedCompletionDate.getDate() + estimatedDays);

            // Calculate confidence based on velocity consistency
            const confidenceLevel = Math.min(0.95, Math.max(0.1, velocity.velocityPerDay * 0.1));

            // Store projection
            await client.query(`
                INSERT INTO completion_projections
                (user_id, category, subcategory, current_completion, target_completion, estimated_days, estimated_completion_date, confidence_level)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [userId, category, subcategory, current.completion_percentage, targetCompletion, estimatedDays, estimatedCompletionDate, confidenceLevel]);

            return {
                currentCompletion: current.completion_percentage,
                targetCompletion,
                estimatedDays,
                estimatedCompletionDate,
                confidenceLevel,
                velocityPerDay: velocity.velocityPerDay
            };
        } finally {
            client.release();
        }
    },

    getProfessionCollectionStats: async function(userId) {
        const client = await pool.connect();
        try {
            // Calculate profession completion stats from existing profession data
            const result = await client.query(`
                WITH profession_stats AS (
                    SELECT
                        profession_name,
                        COUNT(*) as total_recipes,
                        SUM(CASE WHEN completion_percentage = 100 THEN 1 ELSE 0 END) as completed_recipes,
                        AVG(completion_percentage) as avg_completion
                    FROM enhanced_professions_summary
                    WHERE user_id = $1
                    GROUP BY profession_name
                )
                SELECT
                    profession_name as category,
                    'recipes' as subcategory,
                    total_recipes as total_possible,
                    completed_recipes as total_collected,
                    ROUND(avg_completion, 2) as completion_percentage
                FROM profession_stats
                ORDER BY avg_completion DESC
            `, [userId]);

            return result.rows;
        } finally {
            client.release();
        }
    },

    createPriceAlert: async function(userId, itemId, targetPrice, connectedRealmId) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                INSERT INTO price_alerts (user_id, item_id, target_price, connected_realm_id)
                VALUES ($1, $2, $3, $4)
                RETURNING id
            `, [userId, itemId, targetPrice, connectedRealmId]);

            return result.rows[0].id;
        } finally {
            client.release();
        }
    },

    // Connected Realms Functions
    updateConnectedRealmMapping: async function(connectedRealmId, realmData, region) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const realm of realmData.realms) {
                await client.query(`
                    INSERT INTO connected_realms (
                        connected_realm_id, realm_slug, realm_name, region,
                        locale, timezone, population
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (connected_realm_id, realm_slug, region)
                    DO UPDATE SET
                        realm_name = EXCLUDED.realm_name,
                        locale = EXCLUDED.locale,
                        timezone = EXCLUDED.timezone,
                        population = EXCLUDED.population,
                        last_updated = CURRENT_TIMESTAMP
                `, [
                    connectedRealmId,
                    realm.slug,
                    realm.name,
                    region,
                    realm.locale || null,
                    realm.timezone || null,
                    realm.population?.type || null
                ]);
            }

            await client.query('COMMIT');
            console.log(`✅ Updated connected realm mapping for ${connectedRealmId}: ${realmData.realms.length} realms`);
            return { realmsUpdated: realmData.realms.length };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    getConnectedRealms: async function(region = null) {
        const client = await pool.connect();
        try {
            let query = `
                SELECT connected_realm_id, realm_slug, realm_name, region,
                       locale, timezone, population, last_updated
                FROM connected_realms
            `;
            const params = [];

            if (region) {
                query += ' WHERE region = $1';
                params.push(region);
            }

            query += ' ORDER BY connected_realm_id, realm_slug';

            const result = await client.query(query, params);
            return result.rows;
        } finally {
            client.release();
        }
    },

    getRealmsByConnectedRealmId: async function(connectedRealmId, region) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT realm_slug, realm_name, locale, timezone, population
                FROM connected_realms
                WHERE connected_realm_id = $1 AND region = $2
                ORDER BY realm_slug
            `, [connectedRealmId, region]);

            return result.rows;
        } finally {
            client.release();
        }
    },

    findConnectedRealmId: async function(realmSlug, region) {
        const client = await pool.connect();
        try {
            const result = await client.query(`
                SELECT connected_realm_id
                FROM connected_realms
                WHERE realm_slug = $1 AND region = $2
                LIMIT 1
            `, [realmSlug, region]);

            return result.rows.length > 0 ? result.rows[0].connected_realm_id : null;
        } finally {
            client.release();
        }
    }
};

// Database migration function
async function runMigrations(client) {
    console.log('🔄 Running database migrations...');

    try {
        // Migration 1: Add region column to auction_prices if it doesn't exist
        try {
            await client.query(`
                ALTER TABLE auction_prices
                ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'us'
            `);
            console.log('✅ Migration: Added region column to auction_prices');
        } catch (error) {
            console.log('⚠️ Migration warning (auction_prices region):', error.message);
        }

        // Migration 2: Add region column to current_auctions if it doesn't exist
        try {
            await client.query(`
                ALTER TABLE current_auctions
                ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'us'
            `);
            console.log('✅ Migration: Added region column to current_auctions');
        } catch (error) {
            console.log('⚠️ Migration warning (current_auctions region):', error.message);
        }

        // Migration 3: Update existing auction data to have 'us' region if null
        try {
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
        } catch (error) {
            console.log('⚠️ Migration warning (region updates):', error.message);
        }

        // Migration 4: Update current_auctions primary key to include region
        try {
            // First, check if the constraint needs updating
            const constraintCheck = await client.query(`
                SELECT constraint_name
                FROM information_schema.table_constraints
                WHERE table_name = 'current_auctions'
                AND constraint_type = 'PRIMARY KEY'
                AND constraint_name = 'current_auctions_pkey'
            `);

            if (constraintCheck.rows.length > 0) {
                // Drop the old primary key constraint
                await client.query(`
                    ALTER TABLE current_auctions
                    DROP CONSTRAINT current_auctions_pkey
                `);
            }

            // Add the new primary key constraint that includes region
            await client.query(`
                ALTER TABLE current_auctions
                ADD CONSTRAINT current_auctions_pkey
                PRIMARY KEY (connected_realm_id, item_id, region)
            `);
        } catch (error) {
            console.log('⚠️ Migration warning (primary key update):', error.message);
        }

    } catch (error) {
        console.error('❌ Migration error:', error.message);
        // Don't throw - let the app continue even if migrations have issues
    }
}

module.exports = {
    pool,
    initDatabase,
    ...dbHelpers
};