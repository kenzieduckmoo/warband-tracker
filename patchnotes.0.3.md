# Warband Tracker - Version 0.3.0 Patch Notes

## 🎉 Major Features

### 📚 Comprehensive Quest Tracking System
- **NEW**: Complete quest database system for accurate zone completion tracking
- **NEW**: Shows zones sorted by number of incomplete quests (most incomplete first)
- **NEW**: Multi-user shared quest database - all users contribute to building comprehensive quest data
- **NEW**: Background quest discovery service runs automatically every 6 hours
- **NEW**: Intelligent quest ID sampling across all WoW expansions (Classic → War Within)

### 🔄 Enhanced Quest Sync
- **IMPROVED**: Quest sync now contributes discovered quests to shared database
- **IMPROVED**: 6-hour caching prevents unnecessary API calls
- **IMPROVED**: Rate limiting and delays prevent Battle.net API issues
- **NEW**: Shows community contribution ("Added X new quests to shared database for all users")

### 🗡️ Smart Quest Discovery
- **NEW**: Rotating offset system ensures different quest IDs are discovered each run
- **NEW**: Systematic sampling covers quest ID ranges for each expansion:
  - Classic: 1-15,000
  - Burning Crusade: 9,000-12,000
  - Wrath of the Lich King: 11,000-14,500
  - Cataclysm: 14,000-29,000
  - Mists of Pandaria: 28,000-35,000
  - Warlords of Draenor: 33,000-40,000
  - Legion: 38,000-48,000
  - Battle for Azeroth: 46,000-58,000
  - Shadowlands: 57,000-66,000
  - Dragonflight & War Within: 65,000-85,000

## 🎮 User Interface Changes

### 📚 New Button: Populate Quest Cache
- One-time setup to build initial quest database from Battle.net API
- Triggers background quest discovery for comprehensive coverage
- Shows detailed progress feedback

### 🏷️ Enhanced Zone Display
- **NEW**: Red "X incomplete" badges on zone items showing remaining quest count
- **IMPROVED**: Zones automatically sorted by most incomplete quests first
- **IMPROVED**: Better messaging when no quest data is available

### 🔗 Footer Updates
- **NEW**: "Kenzie DuckMoo" name is now a clickable link to https://linktr.ee/brandiraine
- **UPDATED**: Version number to 0.3.0
- **IMPROVED**: Link styling with hover effects matching app theme

## ⚙️ Technical Improvements

### 🗃️ Database Schema Updates
- **NEW**: `quest_master_cache` table for comprehensive quest database
- **NEW**: `quest_areas`, `quest_categories`, `quest_types` lookup tables
- **NEW**: `quest_sync_time` field in users table for caching
- **IMPROVED**: Enhanced `warband_completed_quests` table for multi-user support

### 🚀 Background Services
- **NEW**: Automatic quest discovery starts 30 seconds after server startup
- **NEW**: Periodic quest discovery runs every 6 hours without user interaction
- **NEW**: Graceful shutdown handling for background services
- **NEW**: Progressive quest ID discovery with rotating offsets

### 🔧 API Enhancements
- **NEW**: `/api/populate-quest-cache` endpoint for manual quest database building
- **NEW**: `/api/sync-quests` endpoint with enhanced community contribution
- **NEW**: `/api/incomplete-quests-by-zone` endpoint for dashboard zone analysis
- **IMPROVED**: Better error handling and rate limiting across all quest-related endpoints

## 🐛 Bug Fixes

### 🔥 Rate Limiting Issues Fixed
- **FIXED**: Character refresh no longer hits Battle.net API rate limits
- **FIXED**: Quest data fetching separated from character refresh to prevent timeouts
- **IMPROVED**: Smart delays and batching for all API calls

### 📊 Quest Data Issues Resolved
- **FIXED**: "0 quests found" issue replaced with comprehensive quest discovery
- **FIXED**: Inaccurate zone completion percentages
- **FIXED**: Missing quest data preventing proper zone analysis

## 🎯 Community Features

### 👥 Multi-User Quest Database
- Quest database is shared across all users of the app
- When any user syncs their quests, new quest discoveries benefit everyone
- Exponential database growth as more users contribute quest data
- No duplicate quest entries - smart deduplication system

## 📈 Performance Improvements

### ⚡ Optimized Database Operations
- Smart caching prevents redundant quest lookups
- Batch operations for large quest data sets
- Efficient database queries for zone completion analysis

### 🕒 Background Processing
- Quest discovery runs in background without blocking user actions
- Gentle rate limiting respects Battle.net API constraints
- Progressive coverage ensures comprehensive quest database over time

---

## 🔧 For Developers

### New Database Functions
- `getLastQuestSyncTime(userId)`
- `updateQuestSyncTime(userId)`
- `upsertQuestMaster(questData)`
- `getQuestFromMaster(questId)`
- `getIncompleteQuestsByZone(userId)`

### Background Services
- `backgroundQuestDiscovery()` - Main quest discovery engine
- `startPeriodicQuestDiscovery()` - Starts 6-hour interval service
- `stopPeriodicQuestDiscovery()` - Graceful shutdown

### Quest API Functions
- Enhanced `fetchQuestDetails()` with better error handling
- New quest range definitions for systematic discovery
- Rotating offset system for progressive coverage

---

**Known Issues:**
- Quest Index APIs from Battle.net are not publicly available, so we use systematic ID probing instead
- Some very old quests may not be discoverable through Battle.net API
- Initial quest database population may take several background discovery cycles for complete coverage

**Coming Next:**
- Enhanced quest filtering by expansion and zone
- Quest completion statistics and achievements tracking
- Advanced quest search and filtering capabilities