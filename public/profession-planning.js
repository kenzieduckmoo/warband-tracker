// Profession Planning JavaScript

let currentProfession = null;
let userCharacters = [];
let professionMains = {};

// Initialize the page
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔨 Profession Planning page loaded');

    try {
        await loadUserCharacters();
        await loadProfessionMains();
        setupEventListeners();
        updateProfessionList();
    } catch (error) {
        console.error('Failed to initialize profession planning:', error);
        showError('Failed to load profession data. Please refresh the page.');
    }
});

// Load user characters for profession assignment
async function loadUserCharacters() {
    try {
        const response = await fetch('/api/characters-cached');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const characters = await response.json();

        // The cached endpoint returns characters directly, not wrapped in a success object
        userCharacters = characters || [];
        console.log(`Loaded ${userCharacters.length} characters from cache`);
    } catch (error) {
        console.error('Error loading characters:', error);
        throw error;
    }
}

// Load current profession main assignments
async function loadProfessionMains() {
    try {
        const response = await fetch('/api/profession-mains');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success) {
            professionMains = {};
            (data.assignments || []).forEach(assignment => {
                professionMains[assignment.profession_name.toLowerCase()] = {
                    character: assignment.character_name,
                    realm: assignment.realm_slug
                };
            });
            console.log('Loaded profession mains:', professionMains);
        } else {
            console.warn('Profession mains response not successful:', data);
        }
    } catch (error) {
        console.error('Error loading profession mains:', error);
        // Continue without mains - not critical
        professionMains = {};
    }
}

// Update the profession list display with current mains
function updateProfessionList() {
    const professionItems = document.querySelectorAll('.profession-item');

    professionItems.forEach(item => {
        const professionName = item.dataset.profession;
        const mainElement = item.querySelector('.profession-main');

        if (professionMains[professionName]) {
            const main = professionMains[professionName];
            mainElement.textContent = `${main.character} (${main.realm})`;
            mainElement.classList.add('assigned');
        } else {
            mainElement.textContent = 'No main assigned';
            mainElement.classList.remove('assigned');
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    // Profession item clicks
    document.querySelectorAll('.profession-item').forEach(item => {
        item.addEventListener('click', function() {
            const profession = this.dataset.profession;
            selectProfession(profession);
        });
    });

    // Assign buttons
    document.querySelectorAll('.assign-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation(); // Prevent profession selection
            const profession = this.dataset.profession;
            openCharacterModal(profession);
        });
    });

    // Modal close
    document.getElementById('close-modal').addEventListener('click', closeCharacterModal);
    document.getElementById('character-modal').addEventListener('click', function(e) {
        if (e.target === this) closeCharacterModal();
    });

    // Quick action buttons
    document.getElementById('assign-all-mains-btn').addEventListener('click', showAssignAllMains);
    document.getElementById('view-summary-btn').addEventListener('click', showCostSummary);
    document.getElementById('refresh-data-btn').addEventListener('click', refreshAuctionData);

    // Filters and sorting
    document.getElementById('sort-filter').addEventListener('change', sortRecipes);
    document.getElementById('export-shopping-list').addEventListener('click', exportShoppingList);
}

// Select a profession and load its details
async function selectProfession(professionName) {
    console.log(`Selecting profession: ${professionName}`);

    // Update UI state
    document.querySelectorAll('.profession-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-profession="${professionName}"]`).classList.add('active');

    // Show profession details section
    document.getElementById('welcome-section').style.display = 'none';
    document.getElementById('profession-details').style.display = 'block';

    // Update profession title
    const title = professionName.charAt(0).toUpperCase() + professionName.slice(1);
    document.getElementById('selected-profession-title').textContent = `${title} Planning`;

    currentProfession = professionName;

    // Load profession data
    await loadProfessionData(professionName);
}

// Load profession cost analysis data
async function loadProfessionData(professionName) {
    try {
        showLoading('Loading recipe data...');

        const response = await fetch(`/api/profession-cost-analysis/${professionName}`);

        console.log('Response status:', response.status);
        console.log('Response ok:', response.ok);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Server response:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log('Received data:', data);

        if (data.success) {
            displayProfessionData(data);
        } else {
            throw new Error(data.error || 'Failed to load profession data');
        }
    } catch (error) {
        console.error('Error loading profession data:', error);
        showError(`Failed to load ${professionName} data: ${error.message}`);
    }
}

// Display profession analysis data
function displayProfessionData(data) {
    console.log('displayProfessionData received:', data);

    // Update stats - map server response fields to UI
    const totalRecipes = data.summary?.total_missing_recipes || 0;
    const missingRecipes = data.summary?.total_missing_recipes || 0;
    const totalCost = data.summary?.total_cost_copper || 0;

    document.getElementById('total-recipes').textContent = totalRecipes;
    document.getElementById('missing-recipes').textContent = missingRecipes;
    document.getElementById('estimated-cost').textContent = formatGold(totalCost);

    // Display recipes
    displayRecipeList(data.recipes || []);

    // Update comparison section
    updateCrossServerComparison(data.cheapestRealms || []);
}

// Display the recipe list with pricing
function displayRecipeList(recipes) {
    const recipeList = document.getElementById('recipe-list');

    if (recipes.length === 0) {
        recipeList.innerHTML = '<div class="no-recipes">🎉 All recipes known for this profession!</div>';
        return;
    }

    let html = '<div class="recipe-grid">';

    recipes.forEach(recipe => {
        const priceText = recipe.lowest_price ?
            `${formatGold(recipe.lowest_price)}` :
            '<span class="no-price">Not available</span>';

        const auctionType = recipe.auction_type === 'commodity' ? '🌍 Commodity' : '🏪 Server-specific';

        html += `
            <div class="recipe-item" data-recipe-id="${recipe.recipe_id}">
                <div class="recipe-header">
                    <div class="recipe-name">${recipe.recipe_name}</div>
                    <div class="recipe-price">${priceText}</div>
                </div>
                <div class="recipe-details">
                    <span class="auction-type">${auctionType}</span>
                    ${recipe.total_quantity ? `<span class="quantity">${recipe.total_quantity} available</span>` : ''}
                </div>
                <div class="recipe-actions">
                    <button class="btn btn-small view-wowhead" data-recipe-id="${recipe.recipe_id}">View on Wowhead</button>
                    <button class="btn btn-small compare-prices" data-recipe-id="${recipe.recipe_id}">Compare Prices</button>
                </div>
            </div>
        `;
    });

    html += '</div>';
    recipeList.innerHTML = html;

    // Add event listeners for recipe actions
    recipeList.querySelectorAll('.view-wowhead').forEach(btn => {
        btn.addEventListener('click', function() {
            const recipeId = this.dataset.recipeId;
            window.open(`https://www.wowhead.com/item=${recipeId}`, '_blank');
        });
    });

    recipeList.querySelectorAll('.compare-prices').forEach(btn => {
        btn.addEventListener('click', function() {
            const recipeId = this.dataset.recipeId;
            showCrossServerComparison(recipeId);
        });
    });
}

// Update cross-server comparison section
function updateCrossServerComparison(cheapestRealms) {
    const comparisonContent = document.getElementById('comparison-content');

    if (cheapestRealms.length === 0) {
        comparisonContent.innerHTML = '<p>No cross-server data available.</p>';
        return;
    }

    let html = '<div class="realm-comparison">';
    html += '<h4>💰 Best Deals by Server</h4>';

    cheapestRealms.forEach(realm => {
        html += `
            <div class="realm-item">
                <div class="realm-name">${realm.realmName}</div>
                <div class="realm-price">${formatGold(realm.averagePrice)}</div>
                <div class="realm-savings">Save ${formatGold(realm.savings)}</div>
            </div>
        `;
    });

    html += '</div>';
    comparisonContent.innerHTML = html;
}

// Show character selection modal
function openCharacterModal(professionName) {
    const modal = document.getElementById('character-modal');
    const modalProfessionName = document.getElementById('modal-profession-name');
    const characterList = document.getElementById('character-list');

    modalProfessionName.textContent = professionName.charAt(0).toUpperCase() + professionName.slice(1);

    // Populate character list
    let html = '';
    userCharacters.forEach(character => {
        html += `
            <div class="character-option" data-character="${character.name}" data-realm="${character.realm}" data-profession="${professionName}">
                <div class="character-info">
                    <div class="character-name">${character.name}</div>
                    <div class="character-details">${character.level} ${character.class} - ${character.realm}</div>
                </div>
            </div>
        `;
    });

    characterList.innerHTML = html;

    // Add click handlers
    characterList.querySelectorAll('.character-option').forEach(option => {
        option.addEventListener('click', function() {
            assignProfessionMain(
                this.dataset.profession,
                this.dataset.character,
                this.dataset.realm
            );
        });
    });

    modal.style.display = 'flex';
}

// Close character selection modal
function closeCharacterModal() {
    document.getElementById('character-modal').style.display = 'none';
}

// Assign a profession main
async function assignProfessionMain(profession, characterName, realm) {
    try {
        const response = await fetch('/api/profession-main', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                profession: profession,
                character: characterName,
                realm: realm
            })
        });

        const data = await response.json();

        if (data.success) {
            // Update local data
            professionMains[profession] = {
                character: characterName,
                realm: realm
            };

            // Update UI
            updateProfessionList();
            closeCharacterModal();

            showSuccess(`${characterName} assigned as ${profession} main!`);
        } else {
            throw new Error(data.error || 'Failed to assign profession main');
        }
    } catch (error) {
        console.error('Error assigning profession main:', error);
        showError(`Failed to assign profession main: ${error.message}`);
    }
}

// Utility functions
function formatGold(copper) {
    if (!copper || copper === 0) return '0g';

    const gold = Math.floor(copper / 10000);
    const silver = Math.floor((copper % 10000) / 100);
    const copperRemaining = copper % 100;

    let result = '';
    if (gold > 0) result += `${gold}g `;
    if (silver > 0) result += `${silver}s `;
    if (copperRemaining > 0 && gold === 0) result += `${copperRemaining}c`;

    return result.trim() || '0g';
}

function showLoading(message) {
    const recipeList = document.getElementById('recipe-list');
    recipeList.innerHTML = `<div class="loading-message">${message}</div>`;
}

function showError(message) {
    console.error(message);
    // You could add a toast notification system here
    alert(message);
}

function showSuccess(message) {
    console.log(message);
    // You could add a toast notification system here
    alert(message);
}

// Sort recipes by the selected criteria
function sortRecipes() {
    const sortFilter = document.getElementById('sort-filter');
    const sortValue = sortFilter.value;
    const recipeGrid = document.querySelector('.recipe-grid');

    if (!recipeGrid) return;

    const recipeItems = Array.from(recipeGrid.children);

    recipeItems.sort((a, b) => {
        switch (sortValue) {
            case 'cost-desc':
                const priceA = extractPrice(a.querySelector('.recipe-price').textContent);
                const priceB = extractPrice(b.querySelector('.recipe-price').textContent);
                return priceB - priceA;
            case 'cost-asc':
                const priceA2 = extractPrice(a.querySelector('.recipe-price').textContent);
                const priceB2 = extractPrice(b.querySelector('.recipe-price').textContent);
                return priceA2 - priceB2;
            case 'name-asc':
                const nameA = a.querySelector('.recipe-name').textContent;
                const nameB = b.querySelector('.recipe-name').textContent;
                return nameA.localeCompare(nameB);
            default:
                return 0;
        }
    });

    // Re-append sorted items
    recipeItems.forEach(item => recipeGrid.appendChild(item));
}

// Extract copper price from formatted gold string
function extractPrice(priceText) {
    if (priceText.includes('Not available')) return 0;

    let copper = 0;
    const goldMatch = priceText.match(/(\d+)g/);
    const silverMatch = priceText.match(/(\d+)s/);
    const copperMatch = priceText.match(/(\d+)c/);

    if (goldMatch) copper += parseInt(goldMatch[1]) * 10000;
    if (silverMatch) copper += parseInt(silverMatch[1]) * 100;
    if (copperMatch) copper += parseInt(copperMatch[1]);

    return copper;
}

// Export shopping list functionality
function exportShoppingList() {
    const recipeItems = document.querySelectorAll('.recipe-item');

    if (recipeItems.length === 0) {
        showError('No recipes to export');
        return;
    }

    let shoppingList = `${currentProfession.charAt(0).toUpperCase() + currentProfession.slice(1)} Shopping List\n`;
    shoppingList += `Generated: ${new Date().toLocaleDateString()}\n\n`;

    let totalCost = 0;

    recipeItems.forEach(item => {
        const name = item.querySelector('.recipe-name').textContent;
        const priceText = item.querySelector('.recipe-price').textContent;
        const auctionType = item.querySelector('.auction-type').textContent;

        shoppingList += `• ${name}\n`;
        shoppingList += `  Price: ${priceText}\n`;
        shoppingList += `  Type: ${auctionType}\n\n`;

        totalCost += extractPrice(priceText);
    });

    shoppingList += `\nTotal Estimated Cost: ${formatGold(totalCost)}`;

    // Create and download the file
    const blob = new Blob([shoppingList], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentProfession}-shopping-list.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showSuccess('Shopping list exported successfully!');
}

// Show assign all mains modal (placeholder for future implementation)
function showAssignAllMains() {
    showError('Assign all mains feature coming in a future update!');
}

// Show cost summary across all professions
async function showCostSummary() {
    try {
        showLoading('Loading cost summary...');

        // This would fetch cost analysis for all professions
        // For now, show a placeholder message
        showError('Cost summary feature coming in a future update!');

    } catch (error) {
        console.error('Error loading cost summary:', error);
        showError('Failed to load cost summary');
    }
}

// Refresh auction house data
async function refreshAuctionData() {
    try {
        showLoading('Refreshing auction data...');

        const response = await fetch('/api/admin/update-auction-house', {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showSuccess('Auction data refreshed successfully!');

            // Reload current profession data if one is selected
            if (currentProfession) {
                await loadProfessionData(currentProfession);
            }
        } else {
            throw new Error(data.error || 'Failed to refresh auction data');
        }
    } catch (error) {
        console.error('Error refreshing auction data:', error);
        showError(`Failed to refresh auction data: ${error.message}`);
    }
}

// Show cross-server price comparison for a specific recipe
async function showCrossServerComparison(recipeId) {
    try {
        showLoading('Loading cross-server comparison...');

        // This would fetch cross-server pricing for the specific recipe
        // For now, show a placeholder message
        showError('Cross-server comparison feature coming in a future update!');

    } catch (error) {
        console.error('Error loading cross-server comparison:', error);
        showError('Failed to load cross-server comparison');
    }
}