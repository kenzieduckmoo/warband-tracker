// Dashboard data
let charactersData = [];
let professionsData = [];
let combinationsData = [];
let notesData = {};

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
    
    // Set up event listeners
    document.getElementById('refresh-btn').addEventListener('click', refreshAllData);
    document.getElementById('logout-btn').addEventListener('click', logout);
    
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
        const [charactersRes, professionsRes, combinationsRes] = await Promise.all([
            fetch('/api/characters-cached'),
            fetch('/api/professions-summary'),
            fetch('/api/combinations')
        ]);
        
        charactersData = await charactersRes.json();
        professionsData = await professionsRes.json();
        combinationsData = await combinationsRes.json();
        
        // Load notes for each character
        for (const char of charactersData) {
            try {
                const notesRes = await fetch(`/api/notes/${char.id}`);
                const notesJson = await notesRes.json();
                if (notesJson.notes) {
                    notesData[char.id] = notesJson.notes;
                }
            } catch (err) {
                console.error(`Failed to load notes for ${char.name}:`, err);
            }
        }
        
// Render all dashboard sections
        renderStats();
        renderCoverage();  // <- This line needs to be changed
        renderProfessions();
        renderTopCharacters();
        renderRecentNotes();        
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        showError('Failed to load dashboard data. Please try refreshing.');
    }
}

// Refresh all data from Battle.net API
async function refreshAllData() {
    const refreshBtn = document.getElementById('refresh-btn');
    refreshBtn.innerHTML = '<span class="loading-spinner"></span> Refreshing...';
    refreshBtn.disabled = true;
    
    try {
        // Fetch fresh data from Battle.net
        const response = await fetch('/api/characters');
        if (response.ok) {
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
    
    // Calculate theoretical maximum (approximate)
    const possibleRaces = ['Human', 'Dwarf', 'Night Elf', 'Gnome', 'Draenei', 'Worgen', 'Pandaren', 
                          'Void Elf', 'Lightforged Draenei', 'Dark Iron Dwarf', 'Kul Tiran', 'Mechagnome',
                          'Orc', 'Undead', 'Tauren', 'Troll', 'Blood Elf', 'Goblin', 
                          'Nightborne', 'Highmountain Tauren', 'Maghar Orc', 'Zandalari Troll', 'Vulpera'];
    const possibleClasses = ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Death Knight', 
                            'Shaman', 'Mage', 'Warlock', 'Monk', 'Druid', 'Demon Hunter', 'Evoker'];
    
    // Not all combos are valid, but let's use a rough estimate
    const estimatedPossible = Math.floor((possibleRaces.length * possibleClasses.length) * 0.4); // ~40% are valid combos
    const percentage = Math.round((uniqueCombos.size / estimatedPossible) * 100);
    
    document.getElementById('coverage-percentage').textContent = `${percentage}%`;
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
                totalCharacters: new Set(),
                maxedCount: 0
            };
        }
        
        professionGroups[prof.profession_name].tiers.push({
            tier: prof.tier_name,
            characters: prof.character_list,
            maxed: prof.maxed_characters
        });
        
        // Parse character list to count unique characters
        if (prof.character_list) {
            prof.character_list.split(', ').forEach(char => {
                const charName = char.split(' (')[0];
                professionGroups[prof.profession_name].totalCharacters.add(charName);
            });
        }
        
        professionGroups[prof.profession_name].maxedCount += prof.maxed_characters || 0;
    });
    
    // Render professions
    let html = '';
    Object.values(professionGroups).forEach(prof => {
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
    });
    
    container.innerHTML = html || '<div class="no-data">No profession data available</div>';
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
            <div class="character-summary" onclick="window.location.href='/characters#${char.id}'">
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
            <div class="note-preview" onclick="window.location.href='/characters#${char.id}'">
                <div class="note-character" style="color: ${classColor}">${char.name}</div>
                <div class="note-text">${char.notes}</div>
            </div>
        `;
    });
    
    container.innerHTML = html;
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

// Show loading state
function showLoadingState() {
    document.getElementById('total-characters').innerHTML = '<span class="loading-spinner"></span>';
    document.getElementById('max-level-chars').innerHTML = '<span class="loading-spinner"></span>';
    document.getElementById('avg-ilvl').innerHTML = '<span class="loading-spinner"></span>';
    document.getElementById('total-professions').innerHTML = '<span class="loading-spinner"></span>';
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