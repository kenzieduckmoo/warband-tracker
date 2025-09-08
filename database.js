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
                last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`, (err) => {
                if (err) console.error('Error creating users table:', err);
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
                last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, name, realm)
            )`, (err) => {
                if (err) console.error('Error creating characters table:', err);
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
                (id, user_id, name, realm, level, class, race, faction, average_item_level, equipped_item_level, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `);
            
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
    }
};

module.exports = {
    db,
    initDatabase,
    ...dbHelpers
};