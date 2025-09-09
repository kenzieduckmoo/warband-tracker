const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

// Create or open database
const db = new sqlite3.Database(path.join(__dirname, 'data', 'wow_characters.db'));

// Initialize database schema with multi-user support
function initDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Users table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                battlenet_id TEXT UNIQUE NOT NULL,
                battlenet_tag TEXT,
                email TEXT,
                region TEXT DEFAULT 'us',
                last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) console.error('Error creating users table:', err);
                
                // Migrate existing users table to add region column
                db.run(`ALTER TABLE users ADD COLUMN region TEXT DEFAULT 'us'`, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.log('Region column already exists or other error:', err.message);
                    }
                });
            });

            // Characters table with user association
            db.run(`CREATE TABLE IF NOT EXISTS characters (
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
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, name, realm)
            )`, (err) => {
                if (err) console.error('Error creating characters table:', err);
                
                // Migrate existing characters table to add missing columns
                db.run(`ALTER TABLE characters ADD COLUMN title TEXT`, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.log('Title column already exists or other error:', err.message);
                    }
                });
                
                db.run(`ALTER TABLE characters ADD COLUMN guild TEXT`, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.log('Guild column already exists or other error:', err.message);
                    }
                });
                
                db.run(`ALTER TABLE characters ADD COLUMN active_spec TEXT`, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.log('Active_spec column already exists or other error:', err.message);
                    }
                });
                
                db.run(`ALTER TABLE characters ADD COLUMN covenant TEXT`, (err) => {
                    if (err && !err.message.includes('duplicate column name')) {
                        console.log('Covenant column already exists or other error:', err.message);
                    }
                });
            });

            // Professions table with user association
            db.run(`CREATE TABLE IF NOT EXISTS professions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                character_id TEXT NOT NULL,
                profession_name TEXT NOT NULL,
                profession_id INTEGER,
                tier_name TEXT,
                tier_id INTEGER,
                skill_level INTEGER,
                max_skill_level INTEGER,
                recipes_known INTEGER,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (character_id) REFERENCES characters(id),
                UNIQUE(character_id, profession_name, tier_name)
            )`, (err) => {
                if (err) console.error('Error creating professions table:', err);
            });

            // Character notes table with user association
            db.run(`CREATE TABLE IF NOT EXISTS character_notes (
                character_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                notes TEXT,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (character_id) REFERENCES characters(id)
            )`, (err) => {
                if (err) console.error('Error creating notes table:', err);
            });

            // Session table for secure session management
            db.run(`CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                access_token TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`, (err) => {
                if (err) console.error('Error creating sessions table:', err);
            });

            // Recipe cache for missing recipe analysis
            db.run(`CREATE TABLE IF NOT EXISTS cached_recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                profession_id INTEGER NOT NULL,
                profession_name TEXT NOT NULL,
                tier_id INTEGER NOT NULL,
                tier_name TEXT NOT NULL,
                category_name TEXT,
                recipe_id INTEGER NOT NULL,
                recipe_name TEXT NOT NULL,
                cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(profession_id, tier_id, recipe_id)
            )`, (err) => {
                if (err) console.error('Error creating cached_recipes table:', err);
            });

            // Known recipes per character
            db.run(`CREATE TABLE IF NOT EXISTS character_known_recipes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                character_id TEXT NOT NULL,
                profession_id INTEGER NOT NULL,
                tier_id INTEGER NOT NULL,
                recipe_id INTEGER NOT NULL,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (character_id) REFERENCES characters(id),
                UNIQUE(character_id, profession_id, tier_id, recipe_id)
            )`, (err) => {
                if (err) console.error('Error creating character_known_recipes table:', err);
            });

            // Class/Race/Faction combinations per user
            db.run(`CREATE TABLE IF NOT EXISTS character_combinations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                class TEXT NOT NULL,
                race TEXT NOT NULL,
                faction TEXT NOT NULL,
                character_id TEXT,
                character_name TEXT,
                character_level INTEGER,
                has_character BOOLEAN DEFAULT 0,
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, class, race, faction)
            )`, (err) => {
                if (err) console.error('Error creating combinations table:', err);
            });

            resolve();
        });
    });
}

// Database helper functions with user context
const dbHelpers = {
    // User management
    findOrCreateUser: function(battlenetId, battlenetTag, email = null) {
        return new Promise((resolve, reject) => {
            const userId = `user_${battlenetId}`;
            
            db.get(`SELECT * FROM users WHERE battlenet_id = ?`, [battlenetId], (err, user) => {
                if (err) return reject(err);
                
                if (user) {
                    // Update last login
                    db.run(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`, [user.id]);
                    return resolve(user);
                }
                
                // Create new user
                const stmt = db.prepare(`
                    INSERT INTO users (id, battlenet_id, battlenet_tag, email)
                    VALUES (?, ?, ?, ?)
                `);
                
                stmt.run(userId, battlenetId, battlenetTag, email, function(err) {
                    if (err) return reject(err);
                    
                    resolve({
                        id: userId,
                        battlenet_id: battlenetId,
                        battlenet_tag: battlenetTag,
                        email: email
                    });
                });
                stmt.finalize();
            });
        });
    },

    // Update or insert character for specific user
    upsertCharacter: function(userId, character) {
        return new Promise((resolve, reject) => {
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO characters 
                (id, user_id, name, realm, level, class, race, faction, average_item_level, equipped_item_level, title, guild, active_spec, covenant, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
            // Serialize title data as JSON if it's an object
            const titleData = character.title ? JSON.stringify(character.title) : null;
            
            stmt.run(
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
                character.covenant,
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
            stmt.finalize();
        });
    },

    // Update or insert profession for specific user
    upsertProfessionTier: function(userId, characterId, professionName, professionId, tier) {
        return new Promise((resolve, reject) => {
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO professions 
                (user_id, character_id, profession_name, profession_id, tier_name, tier_id, 
                 skill_level, max_skill_level, recipes_known, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
            stmt.run(
                userId,
                characterId,
                professionName,
                professionId,
                tier.name,
                tier.id || null,
                tier.skillLevel,
                tier.maxSkill,
                tier.recipes || 0,
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
            stmt.finalize();
        });
    },

    // Get all characters for a specific user
    getAllCharacters: function(userId) {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT c.*, 
                GROUP_CONCAT(DISTINCT p.profession_name) as professions_list
                FROM characters c
                LEFT JOIN professions p ON c.id = p.character_id
                WHERE c.user_id = ?
                GROUP BY c.id
                ORDER BY c.average_item_level DESC
            `, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // Get character with professions for specific user
    getCharacterWithProfessions: function(userId, characterId) {
        return new Promise((resolve, reject) => {
            const character = {};
            
            db.get(`SELECT * FROM characters WHERE id = ? AND user_id = ?`, 
                [characterId, userId], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                
                character.info = row;
                
                db.all(`SELECT * FROM professions WHERE character_id = ? AND user_id = ?`, 
                    [characterId, userId], (err, profRows) => {
                    if (err) return reject(err);
                    character.professions = profRows || [];
                    resolve(character);
                });
            });
        });
    },

    // Save character notes for specific user
    saveNotes: function(userId, characterId, notes) {
        return new Promise((resolve, reject) => {
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO character_notes (character_id, user_id, notes, last_updated)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
            stmt.run(characterId, userId, notes, (err) => {
                if (err) reject(err);
                else resolve();
            });
            stmt.finalize();
        });
    },

    // Get character notes for specific user
    getNotes: function(userId, characterId) {
        return new Promise((resolve, reject) => {
            db.get(`SELECT notes FROM character_notes WHERE character_id = ? AND user_id = ?`, 
                [characterId, userId], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.notes : '');
            });
        });
    },

    // Get all notes for a user's characters
    getAllNotes: function(userId) {
        return new Promise((resolve, reject) => {
            db.all(`SELECT character_id, notes FROM character_notes WHERE user_id = ? AND notes IS NOT NULL AND notes != ''`, 
                [userId], (err, rows) => {
                if (err) reject(err);
                else {
                    const notesMap = {};
                    rows.forEach(row => {
                        notesMap[row.character_id] = row.notes;
                    });
                    resolve(notesMap);
                }
            });
        });
    },

    // Get profession summary for specific user
    getProfessionSummary: function(userId) {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.profession_name,
                    p.tier_name,
                    COUNT(DISTINCT p.character_id) as total_characters,
                    COUNT(CASE WHEN p.skill_level = p.max_skill_level THEN 1 END) as maxed_characters,
                    GROUP_CONCAT(
                        c.name || ' (' || p.skill_level || '/' || p.max_skill_level || ')', 
                        ', '
                    ) as character_list
                FROM professions p
                JOIN characters c ON p.character_id = c.id
                WHERE p.user_id = ?
                GROUP BY p.profession_name, p.tier_name
                ORDER BY p.profession_name, p.tier_name
            `, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // Update class/race/faction combinations for specific user
    updateCombinations: function(userId, characters) {
        return new Promise((resolve, reject) => {
            // First, mark all existing combinations for this user as not existing
            db.run(`UPDATE character_combinations SET has_character = 0 WHERE user_id = ?`, 
                [userId], (err) => {
                if (err) return reject(err);
                
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO character_combinations 
                    (user_id, class, race, faction, character_id, character_name, character_level, has_character, last_updated)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
                `);
                
                characters.forEach(char => {
                    stmt.run(
                        userId,
                        char.class,
                        char.race,
                        char.faction,
                        char.id,
                        char.name,
                        char.level
                    );
                });
                
                stmt.finalize(() => resolve());
            });
        });
    },

    // Get missing recipes for a character's profession tier
    getMissingRecipes: function(professionId, tierId, knownRecipeIds = []) {
        return new Promise((resolve, reject) => {
            let query = `
                SELECT * FROM cached_recipes 
                WHERE profession_id = ? AND tier_id = ?
            `;
            const params = [professionId, tierId];
            
            // Exclude known recipes if any provided
            if (knownRecipeIds.length > 0) {
                const placeholders = knownRecipeIds.map(() => '?').join(',');
                query += ` AND recipe_id NOT IN (${placeholders})`;
                params.push(...knownRecipeIds);
            }
            
            query += ` ORDER BY category_name, recipe_name`;
            
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // Check recipe cache status
    getRecipeCacheStatus: function() {
        return new Promise((resolve, reject) => {
            db.get(`
                SELECT 
                    COUNT(*) as total_recipes,
                    MAX(cached_at) as last_cached,
                    COUNT(DISTINCT profession_id) as cached_professions
                FROM cached_recipes
            `, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },

    // Store known recipes for a character
    upsertKnownRecipes: function(userId, characterId, professionId, tierId, knownRecipeIds) {
        return new Promise((resolve, reject) => {
            // Clear existing known recipes for this character's profession tier
            db.run(`DELETE FROM character_known_recipes WHERE character_id = ? AND profession_id = ? AND tier_id = ?`, 
                [characterId, professionId, tierId], (err) => {
                if (err) return reject(err);
                
                if (knownRecipeIds.length === 0) {
                    return resolve(); // No recipes to insert
                }
                
                const stmt = db.prepare(`
                    INSERT INTO character_known_recipes 
                    (user_id, character_id, profession_id, tier_id, recipe_id)
                    VALUES (?, ?, ?, ?, ?)
                `);
                
                // Insert all known recipes
                knownRecipeIds.forEach(recipeId => {
                    stmt.run(userId, characterId, professionId, tierId, recipeId);
                });
                
                stmt.finalize(() => resolve());
            });
        });
    },

    // Get known recipe IDs for a character's profession tier
    getKnownRecipeIds: function(characterId, professionId, tierId) {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT recipe_id FROM character_known_recipes 
                WHERE character_id = ? AND profession_id = ? AND tier_id = ?
            `, [characterId, professionId, tierId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(row => row.recipe_id));
            });
        });
    },

    // Get enhanced profession summary with recipe completion
    getEnhancedProfessionSummary: function(userId) {
        return new Promise((resolve, reject) => {
            // First check if we have cached recipe data
            db.get(`SELECT COUNT(*) as count FROM cached_recipes`, (err, countRow) => {
                if (err) return reject(err);
                
                if (countRow.count === 0) {
                    // No recipe data, fall back to basic profession summary
                    return dbHelpers.getProfessionSummary(userId).then(resolve).catch(reject);
                }
                
                // We have recipe data, so do enhanced summary
                db.all(`
                    WITH profession_tier_recipes AS (
                        SELECT DISTINCT 
                            p.profession_name,
                            p.profession_id,
                            p.tier_name,
                            p.tier_id,
                            COUNT(DISTINCT p.character_id) as total_characters,
                            GROUP_CONCAT(
                                DISTINCT c.name || ' (' || p.skill_level || '/' || p.max_skill_level || ')'
                            ) as character_list
                        FROM professions p
                        JOIN characters c ON p.character_id = c.id
                        WHERE p.user_id = ?
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
                            AND ckr.user_id = ?
                        GROUP BY cr.profession_id, cr.tier_id
                    )
                    SELECT 
                        ptr.*,
                        COALESCE(rs.total_recipes_available, 0) as total_recipes_available,
                        COALESCE(rs.total_recipes_known, 0) as total_recipes_known,
                        ROUND(
                            CASE 
                                WHEN COALESCE(rs.total_recipes_available, 0) > 0 
                                THEN (CAST(COALESCE(rs.total_recipes_known, 0) AS FLOAT) / rs.total_recipes_available) * 100
                                ELSE 0 
                            END, 1
                        ) as completion_percentage
                    FROM profession_tier_recipes ptr
                    LEFT JOIN recipe_stats rs ON ptr.profession_id = rs.profession_id 
                        AND ptr.tier_id = rs.tier_id
                    ORDER BY ptr.profession_name, ptr.tier_name
                `, [userId, userId], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        });
    },

    // Get missing profession coverage (recipes that no character knows)
    getMissingProfessionCoverage: function(userId) {
        return new Promise((resolve, reject) => {
            // First check if we have any cached recipe data
            db.get(`SELECT COUNT(*) as count FROM cached_recipes`, (err, countRow) => {
                if (err) return reject(err);
                
                if (countRow.count === 0) {
                    // No recipe data cached yet, return empty array
                    return resolve([]);
                }
                
                // Find recipes that no character of this user knows
                db.all(`
                    SELECT 
                        cr.profession_name,
                        cr.profession_id,
                        cr.tier_name,
                        cr.tier_id,
                        COUNT(cr.recipe_id) as missing_recipes,
                        GROUP_CONCAT(cr.recipe_name) as missing_recipe_names,
                        GROUP_CONCAT(cr.recipe_id) as missing_recipe_ids
                    FROM cached_recipes cr
                    WHERE NOT EXISTS (
                        SELECT 1 FROM character_known_recipes ckr 
                        WHERE ckr.user_id = ? 
                        AND ckr.recipe_id = cr.recipe_id
                    )
                    GROUP BY cr.profession_name, cr.profession_id, cr.tier_name, cr.tier_id
                    HAVING missing_recipes > 0
                    ORDER BY cr.profession_name, cr.tier_name
                `, [userId], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        });
    },

    // Get combination matrix for specific user
    getCombinationMatrix: function(userId) {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT * FROM character_combinations 
                WHERE user_id = ? AND has_character = 1
                ORDER BY faction, class, race
            `, [userId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    // Session management
    createSession: function(userId, accessToken, expiresIn = 7200) {
        return new Promise((resolve, reject) => {
            const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const expiresAt = new Date(Date.now() + expiresIn * 1000);
            
            const stmt = db.prepare(`
                INSERT INTO sessions (id, user_id, access_token, expires_at)
                VALUES (?, ?, ?, ?)
            `);
            
            stmt.run(sessionId, userId, accessToken, expiresAt.toISOString(), (err) => {
                if (err) reject(err);
                else resolve(sessionId);
            });
            stmt.finalize();
        });
    },

    // Clean up expired sessions
    cleanupSessions: function() {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // Cache recipes for a profession tier
    cacheRecipes: function(professionId, professionName, tierData) {
        return new Promise((resolve, reject) => {
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
            
            // Clear existing recipes for this profession tier
            db.run(`DELETE FROM cached_recipes WHERE profession_id = ? AND tier_id = ?`, 
                [professionId, tierData.id], (err) => {
                if (err) return reject(err);
                
                const stmt = db.prepare(`
                    INSERT INTO cached_recipes 
                    (profession_id, profession_name, tier_id, tier_name, category_name, recipe_id, recipe_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                
                // Insert all recipes from all categories
                for (const category of tierData.categories || []) {
                    const categoryName = extractEnglishText(category);
                    for (const recipe of category.recipes || []) {
                        const recipeName = extractEnglishText(recipe);
                        stmt.run(
                            professionId,
                            professionName,
                            tierData.id,
                            tierData.name || extractEnglishText(tierData),
                            categoryName,
                            recipe.id,
                            recipeName
                        );
                    }
                }
                
                stmt.finalize(() => resolve());
            });
        });
    },

    // Clear all cached recipes to fix corrupted data
    clearCachedRecipes: function() {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM cached_recipes`, (err) => {
                if (err) reject(err);
                else {
                    console.log('Cleared all cached recipes due to corrupted data');
                    resolve();
                }
            });
        });
    },

    // Update user region
    updateUserRegion: function(userId, region) {
        return new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET region = ? WHERE id = ?`,
                [region, userId],
                function(err) {
                    if (err) reject(err);
                    else resolve({ changes: this.changes });
                }
            );
        });
    },

    // Get user region
    getUserRegion: function(userId) {
        return new Promise((resolve, reject) => {
            db.get(
                `SELECT region FROM users WHERE id = ?`,
                [userId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.region || 'us');
                }
            );
        });
    },

    // Get professions for a specific character with recipe counts
    getCharacterProfessions: function(userId, characterId) {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    p.profession_name,
                    p.profession_id,
                    p.tier_name,
                    p.tier_id,
                    p.skill_level,
                    p.max_skill_level,
                    COUNT(DISTINCT cr.recipe_id) as total_recipes,
                    COUNT(DISTINCT ckr.recipe_id) as known_recipes
                FROM professions p
                LEFT JOIN cached_recipes cr ON p.profession_id = cr.profession_id AND p.tier_id = cr.tier_id
                LEFT JOIN character_known_recipes ckr ON p.character_id = ckr.character_id 
                    AND p.profession_id = ckr.profession_id AND p.tier_id = ckr.tier_id 
                    AND cr.recipe_id = ckr.recipe_id
                WHERE p.user_id = ? AND p.character_id = ?
                GROUP BY p.profession_name, p.profession_id, p.tier_name, p.tier_id, p.skill_level, p.max_skill_level
                ORDER BY p.profession_name, p.tier_name
            `, [userId, characterId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};

module.exports = {
    db,
    initDatabase,
    ...dbHelpers
};