// Dashboard data
let charactersData = [];
let allCharactersData = []; // Store unfiltered data
let professionsData = [];
let combinationsData = [];
let notesData = {};
let tokenData = null;
let missingCoverageData = [];
let questZonesData = [];
let currentFilter = '80s'; // Default filter

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    const authResponse = await fetch('/api/auth/status');
    const authData = await authResponse.json();
    
    if (!authData.authenticated) {
        window.location.href = '/';
        return;
    }
    
    // Display user info
    document.getElementById('user-tag').textContent = authData.battlenetTag || 'Player';
    
    // Load current region
    await loadCurrentRegion();
    
    // Set up event listeners
    document.getElementById('refresh-btn').addEventListener('click', refreshAllData);
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('region-select').addEventListener('change', handleRegionChange);
    
    // Set up faction tabs
    document.querySelectorAll('.faction-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.faction-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            renderClassRaceMatrix(e.target.dataset.faction);
        });
    });
    
    // Load all data
    await loadDashboardData();
});

// Load all dashboard data
async function loadDashboardData() {
    try {
        // Show loading state
        showLoadingState();
        
        // Load data in parallel
        const [charactersRes, professionsRes, combinationsRes, tokenRes, missingCoverageRes, notesRes, questZonesRes] = await Promise.all([
            fetch('/api/characters-cached'),
            fetch('/api/enhanced-professions-summary'),
            fetch('/api/combinations'),
            fetch('/api/wow-token'),
            fetch('/api/missing-profession-coverage'),
            fetch('/api/notes-all'),
            fetch('/api/incomplete-quests-by-zone')
        ]);
        
        allCharactersData = await charactersRes.json();
        professionsData = await professionsRes.json();
        combinationsData = await combinationsRes.json();
        tokenData = await tokenRes.json();
        missingCoverageData = await missingCoverageRes.json();
        notesData = await notesRes.json();
        const questZonesResult = await questZonesRes.json();
        questZonesData = questZonesResult.zones || [];

        // Apply default filter to characters
        applyLevelFilter(currentFilter);

        // Set up filter buttons
        setupFilterButtons();

        // Expansion filter removed - no longer needed

        // Render all dashboard sections
        renderStats();
        renderWoWToken();
        renderCoverage();
        renderProfessions();
        renderMissingCoverage();
        renderQuestZones();
        renderTopCharacters();
        renderRecentNotes();        
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        showError('Failed to load dashboard data. Please try refreshing.');
    }
}

// Quest cache and recipe cache functions moved to admin panel only

// Refresh all data from Battle.net API
async function refreshAllData() {
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.innerHTML = '<span class="loading-spinner"></span> Refreshing...';
    refreshBtn.disabled = true;

    try {
        // Fetch fresh data from Battle.net
        const response = await fetch('/api/characters');
        if (response.ok) {
            const result = await response.json();
            console.log('Refresh result:', result);

            // Show quest sync results if available
            if (result.questSync && result.questSync.charactersProcessed > 0) {
                showSuccess(
                    `Character data refreshed successfully! Quest sync: ${result.questSync.charactersProcessed} characters processed, ` +
                    `${result.questSync.totalQuests} total quests, ${result.questSync.questsContributedToDatabase} contributed to shared database.`
                );
            } else {
                showSuccess('Character data refreshed successfully! Quest data was recently synced (within 6 hours).');
            }

            // Reload dashboard with fresh data
            await loadDashboardData();
        } else {
            throw new Error('Failed to refresh data');
        }
    } catch (error) {
        console.error('Failed to refresh data:', error);
        showError('Failed to refresh data from Battle.net');
    } finally {
        refreshBtn.innerHTML = '🔄 Refresh Data';
        refreshBtn.disabled = false;
    }
}

// Render statistics
function renderStats() {
    // Calculate stats
    const totalChars = charactersData.length;
    const maxLevelChars = charactersData.filter(c => c.level === 80).length;
    const avgIlvl = charactersData.length > 0 
        ? Math.round(charactersData.reduce((sum, c) => sum + (c.average_item_level || 0), 0) / charactersData.length)
        : 0;
    
    // Count unique professions
    const uniqueProfessions = new Set();
    professionsData.forEach(prof => {
        uniqueProfessions.add(prof.profession_name);
    });
    
    // Update DOM
    document.getElementById('total-characters').textContent = totalChars;
    document.getElementById('max-level-chars').textContent = maxLevelChars;
    document.getElementById('avg-ilvl').textContent = avgIlvl;
    document.getElementById('total-professions').textContent = uniqueProfessions.size;
}

// Render character coverage by race, class, and faction
function renderCoverage() {
    // Group characters by race, class, and faction
    const races = {};
    const classes = {};
    const factions = {};
    
    charactersData.forEach(char => {
        // Group by race
        if (!races[char.race]) {
            races[char.race] = [];
        }
        races[char.race].push(char);
        
        // Group by class
        if (!classes[char.class]) {
            classes[char.class] = [];
        }
        classes[char.class].push(char);
        
        // Group by faction
        if (!factions[char.faction]) {
            factions[char.faction] = [];
        }
        factions[char.faction].push(char);
    });
    
    // Render race list
    renderCoverageList('race-list', races, 'race');
    
    // Render class list
    renderCoverageList('class-list', classes, 'class');
    
    // Render faction list
    renderCoverageList('faction-list', factions, 'faction');
    
    // Update coverage stats
    const uniqueCombos = new Set();
    charactersData.forEach(char => {
        uniqueCombos.add(`${char.race}-${char.class}-${char.faction}`);
    });
    
    // Update coverage count
    document.getElementById('coverage-count').textContent = `${uniqueCombos.size}`;
}

// Helper function to render a coverage list
function renderCoverageList(elementId, groupedData, type) {
    const container = document.getElementById(elementId);
    let html = '';
    
    // Sort by count (descending) then by name
    const sorted = Object.entries(groupedData).sort((a, b) => {
        const countDiff = b[1].length - a[1].length;
        if (countDiff !== 0) return countDiff;
        return a[0].localeCompare(b[0]);
    });
    
    sorted.forEach(([name, chars]) => {
        const count = chars.length;
        const countClass = count === 0 ? 'zero' : count < 3 ? 'partial' : '';
        const itemId = `${type}-${name.replace(/\s+/g, '-').toLowerCase()}`;
        
        html += `
            <div class="coverage-item ${type === 'faction' ? 'faction-' + name.toLowerCase() : ''}" id="${itemId}">
                <div class="coverage-header" data-item-id="${itemId}">
                    <span class="coverage-name ${type === 'class' ? 'class-' + name.toLowerCase().replace(/\s+/g, '') : ''}">${name}</span>
                    <span>
                        <span class="coverage-count ${countClass}">${count}</span>
                        <span class="expand-arrow">▶</span>
                    </span>
                </div>
                <div class="coverage-characters">
                    ${chars.sort((a, b) => b.level - a.level).map(char => `
                        <span class="character-tag" data-char-id="${char.id}" title="${char.race} ${char.class} - ${char.realm}">
                            ${char.name} <span class="level">(${char.level})</span>
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html || '<div class="no-data">No data available</div>';
    
    // Add event listeners after HTML is inserted
    container.querySelectorAll('.coverage-header').forEach(header => {
        header.addEventListener('click', function() {
            const itemId = this.dataset.itemId;
            const item = document.getElementById(itemId);
            if (item) {
                item.classList.toggle('expanded');
            }
        });
    });
    
    // Add click handlers for character tags
    container.querySelectorAll('.character-tag').forEach(tag => {
        tag.addEventListener('click', function() {
            window.location.href = '/characters#' + this.dataset.charId;
        });
    });
}

// Toggle coverage item expansion
function toggleCoverageItem(itemId) {
    const item = document.getElementById(itemId);
    if (item) {
        item.classList.toggle('expanded');
    }
}

// Remove the old renderClassRaceMatrix function since we're not using it anymore

// Render professions overview
function renderProfessions() {
    const container = document.getElementById('professions-overview');
    
    // Group professions by name
    const professionGroups = {};
    professionsData.forEach(prof => {
        if (!professionGroups[prof.profession_name]) {
            professionGroups[prof.profession_name] = {
                name: prof.profession_name,
                tiers: [],
                totalCharacters: new Set()
            };
        }
        
        // Check if we have enhanced data (recipe completion) or basic data
        const hasRecipeData = prof.total_recipes_available !== undefined;
        
        professionGroups[prof.profession_name].tiers.push({
            tier: prof.tier_name,
            characters: prof.character_list,
            totalRecipes: prof.total_recipes_available || 0,
            knownRecipes: prof.total_recipes_known || 0,
            completionPercentage: prof.completion_percentage || 0,
            maxed: prof.maxed_characters || 0,
            hasRecipeData: hasRecipeData
        });
        
        // Parse character list to count unique characters
        if (prof.character_list) {
            prof.character_list.split(', ').forEach(char => {
                const charName = char.split(' (')[0];
                professionGroups[prof.profession_name].totalCharacters.add(charName);
            });
        }
    });
    
    // Render professions
    let html = '';
    Object.values(professionGroups).forEach(prof => {
        // Check if any tier has recipe data
        const hasAnyRecipeData = prof.tiers.some(tier => tier.hasRecipeData);
        
        if (hasAnyRecipeData) {
            // Enhanced view with recipe completion
            const totalAvailable = prof.tiers.reduce((sum, tier) => sum + tier.totalRecipes, 0);
            const totalKnown = prof.tiers.reduce((sum, tier) => sum + tier.knownRecipes, 0);
            const overallCompletion = totalAvailable > 0 ? Math.round((totalKnown / totalAvailable) * 100) : 0;
            
            html += `
                <div class="profession-item">
                    <div class="profession-header">
                        <span class="profession-name">${prof.name}</span>
                        <span class="profession-count">${prof.totalCharacters.size} chars</span>
                    </div>
                    <div class="profession-completion">
                        <div class="completion-bar">
                            <div class="completion-fill" style="width: ${overallCompletion}%"></div>
                        </div>
                        <span class="completion-text">${totalKnown}/${totalAvailable} recipes (${overallCompletion}%)</span>
                    </div>
                    <div class="expansion-breakdown">
                        ${prof.tiers.map(tier => {
                            const completionClass = tier.completionPercentage >= 90 ? 'high' : 
                                                  tier.completionPercentage >= 50 ? 'medium' : 'low';
                            return `<span class="expansion-tag ${completionClass}" title="${tier.characters || 'None'}">
                                ${tier.tier}: ${tier.knownRecipes}/${tier.totalRecipes} (${tier.completionPercentage}%)
                            </span>`;
                        }).join('')}
                    </div>
                </div>
            `;
        } else {
            // Basic view without recipe data
            html += `
                <div class="profession-item">
                    <div class="profession-header">
                        <span class="profession-name">${prof.name}</span>
                        <span class="profession-count">${prof.totalCharacters.size} chars</span>
                    </div>
                    <div class="expansion-breakdown">
                        ${prof.tiers.map(tier => 
                            `<span class="expansion-tag" title="${tier.characters || 'None'}">${tier.tier}: ${tier.maxed || 0} maxed</span>`
                        ).join('')}
                    </div>
                </div>
            `;
        }
    });
    
    container.innerHTML = html || '<div class="no-data">No profession data available</div>';
}

// Render missing profession coverage
function renderMissingCoverage() {
    const container = document.getElementById('missing-coverage');
    if (!container) return; // Exit if container doesn't exist yet
    
    if (!missingCoverageData || missingCoverageData.length === 0) {
        container.innerHTML = '<div class="no-data">Great! You have coverage for all available profession tiers.</div>';
        return;
    }
    
    // Debug logging removed - functionality working correctly
    
    // Group missing coverage by profession
    const missingGroups = {};
    missingCoverageData.forEach(missing => {
        if (!missingGroups[missing.profession_name]) {
            missingGroups[missing.profession_name] = [];
        }
        missingGroups[missing.profession_name].push(missing);
    });
    
    let html = '';
    Object.entries(missingGroups).forEach(([professionName, tiers]) => {
        html += `
            <div class="missing-profession-group">
                <div class="missing-profession-header">
                    <span class="missing-profession-name">${professionName}</span>
                    <span class="missing-count">${tiers.length} missing</span>
                </div>
                <div class="missing-tiers">
                    ${tiers.map((tier, tierIndex) => {
                        // Get the missing recipes count
                        const recipeCount = tier.missing_recipes || 0;
                        const tierKey = `${professionName.replace(/\s+/g, '-').toLowerCase()}-${tier.tier_name.replace(/\s+/g, '-').toLowerCase()}`;
                        
                        // Parse missing recipes
                        const recipeNames = tier.missing_recipe_names ? tier.missing_recipe_names.split(',') : [];
                        const recipeIds = tier.missing_recipe_ids ? tier.missing_recipe_ids.split(',') : [];
                        
                        return `
                            <div class="missing-tier-container">
                                <span class="missing-tier-tag clickable" data-tier-key="${tierKey}" title="${recipeCount} missing recipes">
                                    ${tier.tier_name} (${recipeCount} missing) <span class="expand-indicator">▼</span>
                                </span>
                                <div class="missing-recipe-list" id="missing-recipes-${tierKey}" style="display: none;">
                                    ${recipeNames.map((recipeName, index) => {
                                        const recipeId = recipeIds[index];
                                        const cleanRecipeName = recipeName.trim();
                                        // Create Wowhead search URL using recipe name for better results
                                        const searchUrl = `https://www.wowhead.com/search?q=${encodeURIComponent(cleanRecipeName)}`;
                                        
                                        return `
                                            <div class="missing-recipe-item">
                                                <a href="${searchUrl}" target="_blank" class="recipe-link" title="Search Wowhead for: ${cleanRecipeName}">
                                                    ${cleanRecipeName}
                                                </a>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners for missing tier expansion
    container.querySelectorAll('.missing-tier-tag.clickable').forEach(tierTag => {
        tierTag.addEventListener('click', function() {
            const tierKey = this.getAttribute('data-tier-key');
            const recipeList = document.getElementById(`missing-recipes-${tierKey}`);
            const expandIndicator = this.querySelector('.expand-indicator');
            
            if (recipeList && expandIndicator) {
                if (recipeList.style.display === 'none') {
                    recipeList.style.display = 'block';
                    expandIndicator.textContent = '▲';
                    this.classList.add('expanded');
                } else {
                    recipeList.style.display = 'none';
                    expandIndicator.textContent = '▼';
                    this.classList.remove('expanded');
                }
            }
        });
    });
}

// Render top characters by item level
function renderTopCharacters() {
    const container = document.getElementById('top-characters');
    
    // Sort by item level and take top 10
    const topChars = [...charactersData]
        .sort((a, b) => (b.average_item_level || 0) - (a.average_item_level || 0))
        .slice(0, 10);
    
    let html = '';
    topChars.forEach(char => {
        const classColor = getClassColor(char.class);
        html += `
            <div class="character-summary clickable-character" data-character-id="${char.id}">
                <div class="character-ilvl">${char.average_item_level || '-'}</div>
                <div class="character-details">
                    <div class="character-name-line" style="color: ${classColor}">${char.name}</div>
                    <div class="character-meta-line">
                        Level ${char.level} ${char.race} ${char.class} • ${char.realm}
                        ${char.professions_list ? `• ${char.professions_list}` : ''}
                    </div>
                </div>
            </div>
        `;
    });
    
    container.innerHTML = html || '<div class="no-data">No character data available</div>';
    
    // Add event listeners for character navigation
    container.querySelectorAll('.clickable-character').forEach(element => {
        element.addEventListener('click', function() {
            const characterId = this.getAttribute('data-character-id');
            window.location.href = `/characters#${characterId}`;
        });
    });
}

// Render recent notes
function renderRecentNotes() {
    const container = document.getElementById('recent-notes');
    
    // Get characters with notes
    const charactersWithNotes = Object.entries(notesData)
        .map(([charId, notes]) => {
            const char = charactersData.find(c => c.id === charId);
            return char ? { ...char, notes } : null;
        })
        .filter(Boolean)
        .slice(0, 5);
    
    if (charactersWithNotes.length === 0) {
        container.innerHTML = '<div class="no-data">No character notes yet. Add notes in the Character Manager!</div>';
        return;
    }
    
    let html = '';
    charactersWithNotes.forEach(char => {
        const classColor = getClassColor(char.class);
        html += `
            <div class="note-preview clickable-character" data-character-id="${char.id}">
                <div class="note-character" style="color: ${classColor}">${char.name}</div>
                <div class="note-text">${char.notes}</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
    
    // Add event listeners for character navigation
    container.querySelectorAll('.clickable-character').forEach(element => {
        element.addEventListener('click', function() {
            const characterId = this.getAttribute('data-character-id');
            window.location.href = `/characters#${characterId}`;
        });
    });
}

// Helper function to get class color
function getClassColor(className) {
    const colors = {
        'Warrior': '#C79C6E',
        'Paladin': '#F58CBA',
        'Hunter': '#ABD473',
        'Rogue': '#FFF569',
        'Priest': '#FFFFFF',
        'Death Knight': '#C41F3B',
        'Shaman': '#0070DE',
        'Mage': '#69CCF0',
        'Warlock': '#9482C9',
        'Monk': '#00FF96',
        'Druid': '#FF7D0A',
        'Demon Hunter': '#A330C9',
        'Evoker': '#33937F'
    };
    return colors[className] || '#888';
}

// Render WoW Token price
function renderWoWToken() {
    if (!tokenData) {
        document.getElementById('token-price').textContent = 'Error';
        document.getElementById('token-updated').textContent = 'Failed to load';
        return;
    }
    
    // Format price with commas
    const formattedPrice = (tokenData.price / 10000).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    });
    
    document.getElementById('token-price').textContent = formattedPrice;
    
    // Format last updated time
    if (tokenData.lastUpdated) {
        const lastUpdated = new Date(tokenData.lastUpdated);
        const timeAgo = getTimeAgo(lastUpdated);
        document.getElementById('token-updated').textContent = `Updated ${timeAgo}`;
    }
}

// Helper function to get "time ago" string
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}

// Show loading state
function showLoadingState() {
    document.getElementById('total-characters').innerHTML = '<span class="loading-spinner"></span>';
    document.getElementById('max-level-chars').innerHTML = '<span class="loading-spinner"></span>';
    document.getElementById('avg-ilvl').innerHTML = '<span class="loading-spinner"></span>';
    document.getElementById('total-professions').innerHTML = '<span class="loading-spinner"></span>';
    document.getElementById('token-price').innerHTML = '<span class="loading-spinner"></span>';
}

// Show error message
function showError(message) {
    // You can implement a toast notification here
    console.error(message);
    alert(message);
}

// Logout function
function logout() {
    window.location.href = '/auth/logout';
}

// Toggle coverage item expansion
window.toggleCoverageItem = function(itemId) {
    const item = document.getElementById(itemId);
    if (item) {
        item.classList.toggle('expanded');
    }
}

// Removed toggleMissingRecipes - now using event listeners to avoid CSP issues

// Level filtering functions
function applyLevelFilter(filter) {
    currentFilter = filter;
    
    switch (filter) {
        case '80s':
            charactersData = allCharactersData.filter(char => char.level === 80);
            break;
        case '70-80':
            charactersData = allCharactersData.filter(char => char.level >= 70 && char.level <= 80);
            break;
        case '10-80':
            charactersData = allCharactersData.filter(char => char.level >= 10 && char.level <= 80);
            break;
        default:
            charactersData = allCharactersData;
    }
    
    // Update filter description
    updateFilterDescription(filter);
    
    // Re-render affected sections
    renderStats();
    renderCoverage();
    renderTopCharacters();
    renderRecentNotes();
}

function updateFilterDescription(filter) {
    const description = document.getElementById('filter-description');
    if (!description) return;
    
    switch (filter) {
        case '80s':
            description.textContent = 'Showing level 80 characters only';
            break;
        case '70-80':
            description.textContent = 'Showing characters level 70-80';
            break;
        case '10-80':
            description.textContent = 'Showing all characters level 10-80';
            break;
    }
}

function setupFilterButtons() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove active class from all buttons
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            
            // Add active class to clicked button
            this.classList.add('active');
            
            // Apply the filter
            const filter = this.getAttribute('data-filter');
            applyLevelFilter(filter);
        });
    });
}

// Load current user region
async function loadCurrentRegion() {
    try {
        const response = await fetch('/api/user-region');
        const data = await response.json();
        
        if (data.region) {
            document.getElementById('region-select').value = data.region;
        }
    } catch (error) {
        console.error('Failed to load user region:', error);
        // Default to US if unable to load
        document.getElementById('region-select').value = 'us';
    }
}

// Handle region change
async function handleRegionChange(event) {
    const newRegion = event.target.value;
    const regionSelect = event.target;
    
    // Show loading state
    regionSelect.disabled = true;
    const originalText = regionSelect.options[regionSelect.selectedIndex].text;
    regionSelect.options[regionSelect.selectedIndex].text = 'Switching...';
    
    try {
        const response = await fetch('/api/user-region', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ region: newRegion })
        });
        
        if (response.ok) {
            // Show success message
            showSuccess(`Region switched to ${newRegion.toUpperCase()}! Please refresh your character data to see ${newRegion === 'us' ? 'NA/OCE' : 'EU'} characters.`);
            
            // Optionally auto-refresh data
            const shouldRefresh = confirm('Would you like to refresh your character data now to load characters from the new region?');
            if (shouldRefresh) {
                await refreshAllData();
            }
        } else {
            throw new Error('Failed to update region');
        }
    } catch (error) {
        console.error('Failed to update region:', error);
        showError('Failed to switch region. Please try again.');
        
        // Revert selection
        await loadCurrentRegion();
    } finally {
        // Reset button state
        regionSelect.disabled = false;
        regionSelect.options[regionSelect.selectedIndex].text = originalText;
    }
}

// Show success message
function showSuccess(message) {
    // Create or update success element
    let successEl = document.querySelector('.success-message');
    if (!successEl) {
        successEl = document.createElement('div');
        successEl.className = 'success-message';
        successEl.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 255, 136, 0.2);
            color: #00ff88;
            border: 1px solid #00ff88;
            border-radius: 8px;
            padding: 12px 20px;
            z-index: 1000;
            font-size: 14px;
            max-width: 400px;
        `;
        document.body.appendChild(successEl);
    }
    
    successEl.textContent = message;
    successEl.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        successEl.style.display = 'none';
    }, 5000);
}

// Setup expansion filter (no longer needed - function kept for compatibility)
function setupExpansionFilter() {
    // Expansion filter removed - no longer needed
}

// Update expansion filter dropdown (no longer needed)
function updateExpansionFilter() {
    // Expansion filter removed - no longer needed
}

// Render quest zones section
function renderQuestZones() {
    const container = document.getElementById('quest-zones-list');
    if (!container) return;

    if (!questZonesData || questZonesData.length === 0) {
        container.innerHTML = '<div class="no-data">No incomplete quest zones found. Either all zones are complete or you need to use the admin panel to populate quest data first.</div>';
        return;
    }

    // Data is already sorted by incomplete_quests DESC from the database query
    // No additional sorting needed

    let html = '';
    questZonesData.forEach(zone => {
        const completionClass = zone.completion_percentage >= 90 ? 'high' :
                               zone.completion_percentage >= 50 ? 'medium' : 'low';

        // Create Wowhead zone link if we have an area_id
        const wowheadLink = zone.area_id ?
            `<a href="https://www.wowhead.com/zone=${zone.area_id}" target="_blank" class="wowhead-link">🔗</a>` :
            '<span class="no-link">—</span>';

        html += `
            <div class="zone-item">
                <div class="zone-header">
                    <span class="zone-name">${zone.zone_name}</span>
                    ${wowheadLink}
                    <span class="zone-incomplete-count">${zone.incomplete_quests} incomplete</span>
                </div>
                <div class="zone-completion">
                    <div class="completion-bar">
                        <div class="completion-fill ${completionClass}" style="width: ${zone.completion_percentage}%"></div>
                    </div>
                    <span class="completion-text">${zone.completed_quests}/${zone.total_quests} (${zone.completion_percentage}%)</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}