// Helper function to guess title position based on common WoW title patterns
function guessTitlePosition(titleName, characterName) {
    if (!titleName) return characterName;
    
    // Titles that typically go after the name (start with "the" or "of")
    const afterNamePatterns = [
        /^the /i,           // "the Seeker", "the Kingslayer", etc.
        /^of /i,            // "of the Nightfall", "of the Iron Vanguard", etc.
        /'s /i,             // "Hellscream's Downfall", "Destroyer's End", etc.
        /End$/i,            // "Storm's End", "Defiler's End", etc.
        /slayer$/i,         // "Titanslayer", "Kingslayer", etc.
        /breaker$/i,        // "Hordebreaker", "Breaker of Chains", etc.
        /Incarnate$/i,      // "Vengeance Incarnate"
        /Vanquisher$/i,     // "Twilight Vanquisher"
        /Downfall$/i        // "Hellscream's Downfall"
    ];
    
    // Check if title should go after the name
    const shouldGoAfter = afterNamePatterns.some(pattern => pattern.test(titleName));
    
    if (shouldGoAfter) {
        return `${characterName} ${titleName}`;
    } else {
        // Default to before the name for titles like "Firelord", "Prelate", "Artisan", etc.
        return `${titleName} ${characterName}`;
    }
}

// Dashboard data
let charactersData = [];
let professionsData = [];
let combinationsData = [];
let notesData = {};
let currentCharacter = null;
let saveTimeout = null;

// Check auth status on load
async function checkAuth() {
    console.log('Checking auth status...');
    try {
        const response = await fetch('/api/auth/status');
        const data = await response.json();
        console.log('Auth status response:', data);
        
        if (data.authenticated) {
            console.log('User is authenticated');
            // Just load characters, no need to show/hide elements
            loadCharacters();
        } else {
            console.log('User is NOT authenticated, redirecting to login');
            window.location.href = '/';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        // Redirect to login on error
        window.location.href = '/';
    }
}

// Load characters from API
async function loadCharacters() {
    const charList = document.getElementById('character-list');
    charList.innerHTML = '<div class="loading">Loading characters...</div>';
    
    try {
        const response = await fetch('/api/characters-cached');
        if (!response.ok) {
            if (response.status === 401) {
                // Token expired or invalid, need to re-login
                document.getElementById('login-btn').style.display = 'block';
                document.getElementById('logout-btn').style.display = 'none';
                document.getElementById('welcome-screen').style.display = 'block';
                document.getElementById('character-detail').style.display = 'none';
                charList.innerHTML = '<div class="loading">Session expired. Please login again.</div>';
                return;
            }
            throw new Error('Failed to fetch characters');
        }
        
        charactersData = await response.json();
        console.log('Loaded characters:', charactersData); // Debug log to see what we got
        displayCharacters();
        
        // Auto-select first character if available
        if (charactersData.length > 0) {
            selectCharacter(charactersData[0]);
        }
    } catch (error) {
        console.error('Failed to load characters:', error);
        console.error('Full error details:', error.stack);
        charList.innerHTML = '<div class="loading">Failed to load characters. Try logging in again.</div>';
        // Show login button if there's an error
        document.getElementById('login-btn').style.display = 'block';
        document.getElementById('logout-btn').style.display = 'none';
    }
}

// Display character list in sidebar
function displayCharacters() {
    const charList = document.getElementById('character-list');
    
    if (charactersData.length === 0) {
        charList.innerHTML = '<div class="loading">No level 10+ characters found</div>';
        return;
    }
    
    charList.innerHTML = charactersData.map(char => {
        const faction = char.faction ? char.faction.toLowerCase().replace(/\s+/g, '') : 'unknown';
        const charClass = char.class ? char.class.toLowerCase().replace(/\s+/g, '') : 'unknown';
        
        // Format professions if available - use professions_list from cached data
        const professionText = char.professions_list || '';
        
        return `
        <div class="character-item faction-${faction}" 
             data-character='${JSON.stringify(char).replace(/'/g, '&apos;')}'
             data-char-id="${char.id}">
            <div class="character-name ${charClass}">${char.name}</div>
            <div class="character-meta">
                ${char.level} ${char.race} ${char.active_spec ? char.active_spec + ' ' : ''}${char.class}
                <br>${char.realm}${char.guild ? ` - <${char.guild}>` : ''}
                ${char.average_item_level ? `• ilvl ${char.average_item_level}` : ''}
                ${professionText ? `<br><small style="color: #999; font-size: 0.75rem;">${professionText}</small>` : ''}
            </div>
        </div>
    `}).join('');
    
    // Add click event listeners to all character items
    document.querySelectorAll('.character-item').forEach(item => {
        item.addEventListener('click', function() {
            const characterData = JSON.parse(this.getAttribute('data-character'));
            selectCharacter(characterData);
        });
    });
}

// Select and display character details
async function selectCharacter(character) {
    currentCharacter = character;
    
    // Update active state in sidebar
    document.querySelectorAll('.character-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.charId === character.id) {
            item.classList.add('active');
        }
    });
    
    // Update main content
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('character-detail').style.display = 'block';
    
    // Populate character details
    let characterName = character.name;
    
    // Parse title data - it's stored as JSON string in the database
    let titleData = null;
    if (character.title) {
        try {
            titleData = typeof character.title === 'string' ? JSON.parse(character.title) : character.title;
        } catch (e) {
            // If parsing fails, treat as plain string
            titleData = character.title;
        }
    }
    
    if (titleData) {
        if (typeof titleData === 'string') {
            // Old format - title is just a string, guess positioning based on title content
            characterName = guessTitlePosition(titleData, character.name);
        } else if (titleData.display_string && typeof titleData.display_string === 'string') {
            // New format - use the display_string which has {name} as a placeholder
            characterName = titleData.display_string.replace('{name}', character.name);
        } else if (titleData.name) {
            // Fallback - guess positioning based on title content
            characterName = guessTitlePosition(titleData.name, character.name);
        }
    }
    
    document.getElementById('char-name').textContent = characterName;
    document.getElementById('char-name').className = character.class.toLowerCase().replace(' ', '');
    document.getElementById('char-level').textContent = `Level ${character.level}`;
    document.getElementById('char-class').textContent = character.active_spec 
        ? `${character.active_spec} ${character.class}`
        : character.class;
    document.getElementById('char-race').textContent = character.race;
    document.getElementById('char-realm').textContent = character.guild 
        ? `${character.realm} - <${character.guild}>`
        : character.realm;
    
    if (character.average_item_level) {
        document.getElementById('char-ilvl').textContent = `ilvl ${character.average_item_level}/${character.equipped_item_level || character.average_item_level}`;
        document.getElementById('char-ilvl').style.display = 'inline-block';
    } else {
        document.getElementById('char-ilvl').style.display = 'none';
    }
    
    // Show covenant if available
    const covenantInfo = document.getElementById('covenant-info');
    if (character.covenant) {
        if (!covenantInfo) {
            // Create covenant element if it doesn't exist
            const covenantDiv = document.createElement('div');
            covenantDiv.id = 'covenant-info';
            covenantDiv.className = 'character-covenant';
            document.querySelector('.character-header').appendChild(covenantDiv);
        }
        document.getElementById('covenant-info').textContent = `Covenant: ${character.covenant}`;
        document.getElementById('covenant-info').style.display = 'block';
    } else if (covenantInfo) {
        covenantInfo.style.display = 'none';
    }
    
    // Load and display professions for this character
    await loadCharacterProfessions(character.id);
    
    // Load notes for this character
    await loadNotes(character.id);
}

// Load and display professions for a character
async function loadCharacterProfessions(characterId) {
    const professionsSection = document.getElementById('professions-section');
    const professionsDetail = document.getElementById('professions-detail');
    
    try {
        // Fetch character's profession data from the API
        const response = await fetch(`/api/character-professions/${characterId}`);
        
        if (!response.ok) {
            // If endpoint doesn't exist, hide the section
            professionsSection.style.display = 'none';
            return;
        }
        
        const professionData = await response.json();
        
        if (!professionData || professionData.length === 0) {
            professionsSection.style.display = 'none';
            return;
        }
        
        professionsSection.style.display = 'block';
        
        // Group professions by name
        const professionGroups = {};
        professionData.forEach(prof => {
            if (!professionGroups[prof.profession_name]) {
                professionGroups[prof.profession_name] = {
                    name: prof.profession_name,
                    tiers: []
                };
            }
            
            professionGroups[prof.profession_name].tiers.push({
                name: prof.tier_name,
                skillLevel: prof.skill_level,
                maxSkill: prof.max_skill_level,
                knownRecipes: prof.known_recipes || 0,
                totalRecipes: prof.total_recipes || 0
            });
        });
        
        // Render profession cards
        professionsDetail.innerHTML = Object.values(professionGroups).map(prof => {
            const tiersHTML = prof.tiers.map(tier => {
                const skillPercent = tier.maxSkill > 0 ? (tier.skillLevel / tier.maxSkill * 100) : 0;
                const recipeInfo = tier.totalRecipes > 0 
                    ? `${tier.knownRecipes}/${tier.totalRecipes} recipes` 
                    : `${tier.knownRecipes} recipes`;
                
                return `
                    <div class="profession-tier">
                        <div class="profession-tier-name">${tier.name}</div>
                        <div class="profession-skill-bar">
                            <div class="profession-skill-fill" style="width: ${skillPercent}%"></div>
                            <div class="profession-skill-text">${tier.skillLevel} / ${tier.maxSkill}</div>
                        </div>
                        <div style="margin-top: 4px; color: #888; font-size: 0.8rem;">${recipeInfo}</div>
                    </div>
                `;
            }).join('');
            
            return `
                <div class="profession-card">
                    <div class="profession-header">${prof.name}</div>
                    ${tiersHTML}
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Failed to load character professions:', error);
        professionsSection.style.display = 'none';
    }
}

// Load notes for a character
async function loadNotes(characterId) {
    try {
        const response = await fetch(`/api/notes/${characterId}`);
        const data = await response.json();
        document.getElementById('notes-area').value = data.notes || '';
    } catch (error) {
        console.error('Failed to load notes:', error);
        document.getElementById('notes-area').value = '';
    }
}

// Save notes for current character
async function saveNotes() {
    if (!currentCharacter) return;
    
    const notes = document.getElementById('notes-area').value;
    const statusDiv = document.getElementById('save-status');
    
    try {
        const response = await fetch(`/api/notes/${currentCharacter.id}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notes })
        });
        
        if (response.ok) {
            statusDiv.textContent = 'Notes saved!';
            statusDiv.className = 'save-status success';
            setTimeout(() => {
                statusDiv.style.display = 'none';
            }, 3000);
        } else {
            throw new Error('Save failed');
        }
    } catch (error) {
        console.error('Failed to save notes:', error);
        statusDiv.textContent = 'Failed to save notes';
        statusDiv.className = 'save-status error';
    }
}

// Auto-save notes on typing (with debounce)
document.addEventListener('DOMContentLoaded', () => {
    const notesArea = document.getElementById('notes-area');
    
    notesArea.addEventListener('input', () => {
        if (saveTimeout) clearTimeout(saveTimeout);
        
        saveTimeout = setTimeout(() => {
            saveNotes();
        }, 2000); // Auto-save after 2 seconds of no typing
    });
    
    
    // Add event listeners when DOM is loaded
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
    
    const saveBtn = document.querySelector('.save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveNotes);
    }
    
    const regionSelect = document.getElementById('region-select');
    if (regionSelect) {
        regionSelect.addEventListener('change', handleRegionChange);
        // Load current region
        loadCurrentRegion();
    }
    
    // Check auth on load
    checkAuth();
});

// Auth functions
function login() {
    window.location.href = '/auth/login';
}

function logout() {
    window.location.href = '/auth/logout';
}

// Region functions
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
            // Show success message and reload characters
            alert(`Region switched to ${newRegion.toUpperCase()}! Loading characters from the new region...`);
            loadCharacters(); // Reload characters from new region
        } else {
            throw new Error('Failed to update region');
        }
    } catch (error) {
        console.error('Failed to update region:', error);
        alert('Failed to switch region. Please try again.');
        
        // Revert selection
        await loadCurrentRegion();
    } finally {
        // Reset button state
        regionSelect.disabled = false;
        regionSelect.options[regionSelect.selectedIndex].text = originalText;
    }
}

// Handle errors in URL params
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('error')) {
    console.error('Auth error:', urlParams.get('error'));
    // Clear the error from URL
    window.history.replaceState({}, document.title, '/');
}