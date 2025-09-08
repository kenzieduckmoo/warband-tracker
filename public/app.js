let characters = [];
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
            console.log('User is authenticated, hiding login button');
            document.getElementById('login-btn').style.display = 'none';
            document.getElementById('logout-btn').style.display = 'block';
            document.getElementById('welcome-screen').style.display = 'none';
            loadCharacters();
        } else {
            console.log('User is NOT authenticated, showing login button');
            document.getElementById('login-btn').style.display = 'block';
            document.getElementById('logout-btn').style.display = 'none';
            document.getElementById('welcome-screen').style.display = 'block';
            document.getElementById('character-detail').style.display = 'none';
            document.getElementById('character-list').innerHTML = '<div class="loading">Please login to view characters</div>';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        // Default to not authenticated if check fails
        document.getElementById('login-btn').style.display = 'block';
        document.getElementById('logout-btn').style.display = 'none';
        document.getElementById('welcome-screen').style.display = 'block';
    }
}

// Load characters from API
async function loadCharacters() {
    const charList = document.getElementById('character-list');
    charList.innerHTML = '<div class="loading">Loading characters...</div>';
    
    try {
        const response = await fetch('/api/characters');
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
        
        characters = await response.json();
        console.log('Loaded characters:', characters); // Debug log to see what we got
        displayCharacters();
        
        // Auto-select first character if available
        if (characters.length > 0) {
            selectCharacter(characters[0]);
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
    
    if (characters.length === 0) {
        charList.innerHTML = '<div class="loading">No level 70+ characters found</div>';
        return;
    }
    
    charList.innerHTML = characters.map(char => {
        // Extract value if it's a localized object
        const getValue = (val) => {
            if (!val) return 'Unknown';
            if (typeof val === 'string') return val;
            if (val.en_US) return val.en_US;
            if (val.name) return val.name;
            return Object.values(val)[0] || 'Unknown';
        };
        
        const faction = getValue(char.faction).toLowerCase().replace(/\s+/g, '');
        const charClass = getValue(char.class).toLowerCase().replace(/\s+/g, '');
        
        // Format professions if available - just show names in sidebar
        const professionText = char.professions && char.professions.length > 0 
            ? char.professions.map(p => p.name).join(', ')
            : '';
        
        return `
        <div class="character-item faction-${faction}" 
             data-character='${JSON.stringify(char).replace(/'/g, '&apos;')}'
             data-char-id="${char.id}">
            <div class="character-name ${charClass}">${char.name}</div>
            <div class="character-meta">
                ${char.level} ${getValue(char.race)} ${getValue(char.class)}
                <br>${getValue(char.realm)}
                ${char.averageItemLevel ? `• ilvl ${char.averageItemLevel}` : ''}
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
    document.getElementById('char-name').textContent = character.name;
    document.getElementById('char-name').className = character.class.toLowerCase().replace(' ', '');
    document.getElementById('char-level').textContent = `Level ${character.level}`;
    document.getElementById('char-class').textContent = character.class;
    document.getElementById('char-race').textContent = character.race;
    document.getElementById('char-realm').textContent = character.realm;
    
    if (character.averageItemLevel) {
        document.getElementById('char-ilvl').textContent = `ilvl ${character.averageItemLevel}/${character.equippedItemLevel}`;
        document.getElementById('char-ilvl').style.display = 'inline-block';
    } else {
        document.getElementById('char-ilvl').style.display = 'none';
    }
    
    // Display professions section if character has professions
    const professionsSection = document.getElementById('professions-section');
    const professionsDetail = document.getElementById('professions-detail');
    
    console.log('Professions section element:', professionsSection);
    console.log('Professions detail element:', professionsDetail);
    
    if (character.professions && character.professions.length > 0) {
        console.log('Showing professions section with', character.professions.length, 'professions');
        professionsSection.style.display = 'block';
        
        // Create profession cards with detailed tier info
        professionsDetail.innerHTML = character.professions.map(prof => {
            console.log('Processing profession:', prof.name, prof);
            let tiersHTML = '';
            
            if (prof.tiers && prof.tiers.length > 0) {
                tiersHTML = prof.tiers.map(tier => {
                    const skillPercent = tier.maxSkill > 0 ? (tier.skillLevel / tier.maxSkill * 100) : 0;
                    return `
                        <div class="profession-tier">
                            <div class="profession-tier-name">${tier.name}</div>
                            <div class="profession-skill-bar">
                                <div class="profession-skill-fill" style="width: ${skillPercent}%"></div>
                                <div class="profession-skill-text">${tier.skillLevel} / ${tier.maxSkill}</div>
                            </div>
                            ${tier.recipes > 0 ? `<div style="margin-top: 4px; color: #888; font-size: 0.8rem;">${tier.recipes} recipes known</div>` : ''}
                        </div>
                    `;
                }).join('');
            } else {
                // Fallback for professions without tier data
                const skillPercent = prof.maxSkill > 0 ? (prof.skillLevel / prof.maxSkill * 100) : 0;
                tiersHTML = `
                    <div class="profession-tier">
                        <div class="profession-skill-bar">
                            <div class="profession-skill-fill" style="width: ${skillPercent}%"></div>
                            <div class="profession-skill-text">${prof.skillLevel} / ${prof.maxSkill}</div>
                        </div>
                    </div>
                `;
            }
            
            return `
                <div class="profession-card">
                    <div class="profession-header">${prof.name}</div>
                    ${prof.totalRecipes ? `<div style="color: #aaa; font-size: 0.9rem; margin-bottom: 10px;">Total recipes: ${prof.totalRecipes}</div>` : ''}
                    ${tiersHTML}
                </div>
            `;
        }).join('');
    } else {
        console.log('No professions or empty array, hiding section');
        professionsSection.style.display = 'none';
    }
    
    // Load notes for this character
    await loadNotes(character.id);
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

// Handle errors in URL params
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('error')) {
    console.error('Auth error:', urlParams.get('error'));
    // Clear the error from URL
    window.history.replaceState({}, document.title, '/');
}