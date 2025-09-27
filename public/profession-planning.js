// Profession Planning JavaScript

let currentProfession = null;
let userCharacters = [];
let professionMains = {};
let professionsData = {};
let missingCoverageData = [];

// Initialize the page
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🔨 Profession Planning page loaded');

    try {
        await loadUserCharacters();
        await loadProfessionData();
        await loadMissingCoverageData();
        await loadProfessionMains();
        setupEventListeners();
        updateProfessionList();

        // Load collection analytics
        await loadCollectionAnalytics();
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

        // Debug: show sample professions_list data
        const sampleChar = userCharacters.find(c => c.professions_list);
        if (sampleChar) {
            console.log('Sample character professions_list:', sampleChar.professions_list);
        } else {
            console.log('No characters found with professions_list data');
        }
    } catch (error) {
        console.error('Error loading characters:', error);
        throw error;
    }
}

// Load profession data using the same endpoint as dashboard
async function loadProfessionData() {
    try {
        const response = await fetch('/api/enhanced-professions-summary');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        professionsData = await response.json();
        console.log('Loaded professions data:', professionsData);
    } catch (error) {
        console.error('Error loading professions data:', error);
        throw error;
    }
}

// Load missing profession coverage data
async function loadMissingCoverageData() {
    try {
        const response = await fetch('/api/missing-profession-coverage');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        missingCoverageData = await response.json();
        console.log('Loaded missing coverage data:', missingCoverageData);
    } catch (error) {
        console.error('Error loading missing coverage data:', error);
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

// Update the profession list display with current mains and character info
function updateProfessionList() {
    console.log('Updating profession list with', userCharacters.length, 'characters');
    const professionItems = document.querySelectorAll('.profession-item');

    professionItems.forEach(item => {
        const professionName = item.dataset.profession;
        const mainElement = item.querySelector('.profession-main');

        // Find characters with this profession from the character list
        const charactersWithProfession = userCharacters.filter(character => {
            if (!character.professions_list) return false;
            const charProfessions = character.professions_list.split(', ').map(p => p.trim().toLowerCase());
            return charProfessions.includes(professionName.toLowerCase());
        });

        const totalChars = charactersWithProfession.length;
        console.log(`Profession ${professionName}: found ${totalChars} characters`);

        if (totalChars > 0) {
            if (professionMains[professionName]) {
                const main = professionMains[professionName];
                mainElement.textContent = `Main: ${main.character} (${totalChars} total)`;
                mainElement.classList.add('assigned');
            } else {
                mainElement.textContent = `${totalChars} character${totalChars !== 1 ? 's' : ''} - No main assigned`;
                mainElement.classList.remove('assigned');
            }
        } else {
            mainElement.textContent = 'No characters with this profession';
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
function selectProfession(professionName) {
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

    // Display profession data using existing dashboard data
    displayProfessionDataFromDashboard(professionName);

    // Update analytics for this profession
    updateProfessionAnalytics(professionName);
}

// Display profession data using existing dashboard data
function displayProfessionDataFromDashboard(professionName) {
    console.log(`Loading profession data for: ${professionName}`);

    // Get profession info from dashboard data
    // professionsData contains tier info, but not character info
    // We need to get character info from the characters list
    const professionTiers = professionsData.filter(tier =>
        tier.profession_name && tier.profession_name.toLowerCase() === professionName.toLowerCase()
    );

    // Find characters with this profession from the character list
    const charactersWithProfession = userCharacters.filter(character => {
        if (!character.professions_list) return false;
        const charProfessions = character.professions_list.split(', ').map(p => p.trim().toLowerCase());
        return charProfessions.includes(professionName.toLowerCase());
    });

    // Get missing recipes for this profession from missing coverage data
    const missingTiers = missingCoverageData.filter(tier =>
        tier.profession_name.toLowerCase() === professionName.toLowerCase()
    );

    // Parse tier summaries into individual recipes
    const missingRecipes = [];
    missingTiers.forEach(tier => {
        if (tier.missing_recipe_ids && tier.missing_recipe_names) {
            const recipeIds = tier.missing_recipe_ids.split(', ').map(id => id.trim());
            const recipeNames = tier.missing_recipe_names.split(', ').map(name => name.trim());

            // Create individual recipe objects
            recipeIds.forEach((recipeId, index) => {
                const recipeName = recipeNames[index] || 'Unknown Recipe';
                missingRecipes.push({
                    recipe_id: parseInt(recipeId),
                    recipe_name: recipeName,
                    tier_name: tier.tier_name,
                    tier_id: tier.tier_id,
                    profession_name: tier.profession_name
                });
            });
        }
    });

    console.log('Profession tiers:', professionTiers);
    console.log('Characters with profession:', charactersWithProfession);
    console.log('Missing recipes:', missingRecipes);

    // Calculate statistics
    const totalCharacters = charactersWithProfession.length;
    const totalMissingRecipes = missingRecipes.length;

    // Update stats display
    document.getElementById('total-recipes').textContent = `${totalCharacters} characters`;
    document.getElementById('missing-recipes').textContent = totalMissingRecipes;
    document.getElementById('estimated-cost').textContent = 'Calculating...';

    // Display character list for this profession
    displayProfessionCharacters(charactersWithProfession);

    // Display missing recipes
    displayMissingRecipes(missingRecipes);

    // Load auction house prices for missing recipes
    loadAuctionHousePrices(missingRecipes);
}

// Display characters for the selected profession
function displayProfessionCharacters(charactersWithProfession) {
    const characterGrid = document.getElementById('character-grid');

    if (!charactersWithProfession || charactersWithProfession.length === 0) {
        characterGrid.innerHTML = '<div class="no-characters">No characters found with this profession.</div>';
        return;
    }

    let html = '';
    charactersWithProfession.forEach(character => {
        const isMain = professionMains[currentProfession]?.character === character.name;

        html += `
            <div class="character-card ${isMain ? 'selected' : ''}" data-character="${character.name}">
                <div class="character-name">
                    ${character.name}
                    ${isMain ? '<span class="character-main-badge">MAIN</span>' : ''}
                </div>
                <div class="character-details">
                    Level ${character.level} ${character.class} - ${character.realm}
                </div>
                <div class="character-profession-info">
                    Item Level: ${character.average_item_level || 'N/A'}
                </div>
            </div>
        `;
    });

    characterGrid.innerHTML = html;

    // Add click handlers for character selection
    characterGrid.querySelectorAll('.character-card').forEach(card => {
        card.addEventListener('click', function() {
            const characterName = this.dataset.character;
            selectProfessionCharacter(characterName);
        });
    });
}

// Display missing recipes with auction house pricing
function displayMissingRecipes(missingRecipes) {
    const recipeList = document.getElementById('recipe-list');

    if (missingRecipes.length === 0) {
        recipeList.innerHTML = '<div class="no-recipes">🎉 All recipes known for this profession!</div>';
        return;
    }

    let html = '<div class="recipe-grid">';

    missingRecipes.forEach(recipe => {
        const recipeId = recipe.recipe_id || 'invalid';
        const recipeName = recipe.recipe_name || 'Unknown Recipe';
        const tierName = recipe.tier_name || 'Unknown Tier';

        html += `
            <div class="recipe-item" data-recipe-id="${recipeId}">
                <div class="recipe-header">
                    <div class="recipe-name">${recipeName}</div>
                    <div class="recipe-price" id="price-${recipeId}">
                        ${recipeId === 'invalid' ? 'Invalid recipe data' : 'Checking prices...'}
                    </div>
                </div>
                <div class="recipe-details">
                    <span class="auction-type">📋 Missing Recipe</span>
                    <span class="tier-info">${tierName}</span>
                </div>
                <div class="recipe-actions">
                    <button class="btn btn-small view-wowhead" data-recipe-id="${recipeId}" ${recipeId === 'invalid' ? 'disabled' : ''}>View on Wowhead</button>
                    <button class="btn btn-small compare-prices" data-recipe-id="${recipeId}" data-recipe-name="${recipeName}" ${recipeId === 'invalid' ? 'disabled' : ''}>Compare Prices</button>
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
            if (recipeId && recipeId !== 'invalid' && !this.disabled) {
                window.open(`https://www.wowhead.com/item=${recipeId}`, '_blank');
            }
        });
    });

    recipeList.querySelectorAll('.compare-prices').forEach(btn => {
        btn.addEventListener('click', function() {
            const recipeId = this.dataset.recipeId;
            const recipeName = this.dataset.recipeName;
            if (recipeId && recipeId !== 'invalid' && !this.disabled) {
                showCrossServerComparison(recipeId, recipeName);
            }
        });
    });
}

// Load auction house prices for missing recipes (bulk API call)
async function loadAuctionHousePrices(missingRecipes) {
    if (missingRecipes.length === 0) return;

    console.log(`Loading bulk auction prices for ${missingRecipes.length} recipes...`);

    // Extract valid recipe IDs
    const validRecipeIds = missingRecipes
        .filter(recipe => recipe.recipe_id && !isNaN(recipe.recipe_id))
        .map(recipe => recipe.recipe_id);

    if (validRecipeIds.length === 0) {
        console.warn('No valid recipe IDs found');
        return;
    }

    // Handle large lists by chunking if necessary
    const maxChunkSize = 1000;
    if (validRecipeIds.length > maxChunkSize) {
        console.log(`Large recipe list (${validRecipeIds.length}), processing in chunks...`);
        await loadAuctionHousePricesInChunks(missingRecipes, validRecipeIds, maxChunkSize);
        return;
    }

    try {
        // Make a single bulk API call instead of individual calls
        const response = await fetch('/api/auction-prices-bulk', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ itemIds: validRecipeIds })
        });

        const bulkPriceData = await response.json();

        if (!bulkPriceData.success) {
            throw new Error(bulkPriceData.error || 'Failed to load bulk pricing');
        }

        console.log(`Received bulk pricing data for ${Object.keys(bulkPriceData.prices || {}).length} items`);

        let totalCost = 0;
        let pricesFound = 0;

        // Update UI with bulk pricing data
        missingRecipes.forEach(recipe => {
            const priceElement = document.getElementById(`price-${recipe.recipe_id}`);
            if (!priceElement) return;

            const priceData = bulkPriceData.prices[recipe.recipe_id];

            if (priceData && priceData.lowest_price) {
                const price = parseInt(priceData.lowest_price);
                priceElement.textContent = formatGold(price);
                priceElement.className = 'recipe-price';

                // Add auction type indicator
                const auctionTypeElement = priceElement.parentElement.parentElement.querySelector('.auction-type');
                if (priceData.is_commodity) {
                    auctionTypeElement.textContent = '🌍 Commodity';
                } else {
                    auctionTypeElement.textContent = '🏪 Server-specific';
                }

                totalCost += price;
                pricesFound++;
            } else {
                priceElement.textContent = 'Not available';
                priceElement.className = 'recipe-price no-price';
            }
        });

        // Update total estimated cost
        document.getElementById('estimated-cost').textContent = formatGold(totalCost);

        console.log(`Loaded prices for ${pricesFound}/${missingRecipes.length} recipes. Total cost: ${formatGold(totalCost)}`);

        // Apply default sorting (least expensive first)
        sortRecipes();

    } catch (error) {
        console.error('Failed to load bulk auction prices:', error);
        // Fall back to showing "Price unavailable" for all
        missingRecipes.forEach(recipe => {
            const priceElement = document.getElementById(`price-${recipe.recipe_id}`);
            if (priceElement) {
                priceElement.textContent = 'Price unavailable';
                priceElement.className = 'recipe-price no-price';
            }
        });
    }
}

// Load auction house prices in chunks for large lists
async function loadAuctionHousePricesInChunks(missingRecipes, validRecipeIds, chunkSize) {
    let totalCost = 0;
    let pricesFound = 0;
    let totalChunks = Math.ceil(validRecipeIds.length / chunkSize);

    for (let i = 0; i < validRecipeIds.length; i += chunkSize) {
        const chunk = validRecipeIds.slice(i, i + chunkSize);
        const chunkNumber = Math.floor(i / chunkSize) + 1;

        console.log(`Loading chunk ${chunkNumber}/${totalChunks} (${chunk.length} items)...`);

        try {
            const response = await fetch('/api/auction-prices-bulk', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ itemIds: chunk })
            });

            const bulkPriceData = await response.json();

            if (bulkPriceData.success) {
                // Update UI with this chunk's pricing data
                missingRecipes.forEach(recipe => {
                    if (!chunk.includes(recipe.recipe_id)) return;

                    const priceElement = document.getElementById(`price-${recipe.recipe_id}`);
                    if (!priceElement) return;

                    const priceData = bulkPriceData.prices[recipe.recipe_id];

                    if (priceData && priceData.lowest_price) {
                        const price = parseInt(priceData.lowest_price);
                        priceElement.textContent = formatGold(price);
                        priceElement.className = 'recipe-price';

                        // Add auction type indicator
                        const auctionTypeElement = priceElement.parentElement.parentElement.querySelector('.auction-type');
                        if (priceData.is_commodity) {
                            auctionTypeElement.textContent = '🌍 Commodity';
                        } else {
                            auctionTypeElement.textContent = '🏪 Server-specific';
                        }

                        totalCost += price;
                        pricesFound++;
                    } else {
                        priceElement.textContent = 'Not available';
                        priceElement.className = 'recipe-price no-price';
                    }
                });

                console.log(`Chunk ${chunkNumber} complete: found ${Object.keys(bulkPriceData.prices || {}).length} prices`);
            }
        } catch (error) {
            console.error(`Failed to load chunk ${chunkNumber}:`, error);
        }
    }

    // Update final total
    document.getElementById('estimated-cost').textContent = formatGold(totalCost);
    console.log(`All chunks complete: ${pricesFound}/${missingRecipes.length} recipes priced. Total cost: ${formatGold(totalCost)}`);
}

// Select a character for profession focus
function selectProfessionCharacter(characterName) {
    // Update visual selection
    document.querySelectorAll('.character-card').forEach(card => {
        card.classList.remove('selected');
    });
    document.querySelector(`[data-character="${characterName}"]`).classList.add('selected');

    console.log(`Selected character: ${characterName} for ${currentProfession}`);

    // This could trigger updates to show character-specific recipe data
    showSuccess(`Viewing ${currentProfession} data for ${characterName}`);
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
                    <button class="btn btn-small compare-prices" data-recipe-id="${recipe.recipe_id}" data-recipe-name="${recipe.recipe_name}">Compare Prices</button>
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
            const recipeName = this.dataset.recipeName;
            showCrossServerComparison(recipeId, recipeName);
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

    // Filter characters to only show those with this profession
    const charactersWithProfession = userCharacters.filter(character => {
        if (!character.professions_list) return false;
        const charProfessions = character.professions_list.split(', ').map(p => p.trim().toLowerCase());
        return charProfessions.includes(professionName.toLowerCase());
    });

    // Populate character list
    let html = '';
    if (charactersWithProfession.length === 0) {
        html = '<div class="no-characters">No characters found with this profession</div>';
    } else {
        charactersWithProfession.forEach(character => {
            html += `
                <div class="character-option" data-character="${character.name}" data-realm="${character.realm}" data-profession="${professionName}">
                    <div class="character-info">
                        <div class="character-name">${character.name}</div>
                        <div class="character-details">${character.level} ${character.class} - ${character.realm}</div>
                    </div>
                </div>
            `;
        });
    }

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
                professionName: profession,
                characterId: `${realm.toLowerCase().replace(/\s+/g, '-').replace(/['']/g, '').replace(/[^a-z0-9-]/g, '')}-${characterName.toLowerCase()}`,
                priority: 1
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
                const priceTextA = a.querySelector('.recipe-price').textContent;
                const priceTextB = b.querySelector('.recipe-price').textContent;
                const isNotAvailableA = priceTextA.includes('Not available');
                const isNotAvailableB = priceTextB.includes('Not available');

                // Put "Not available" items at the end
                if (isNotAvailableA && !isNotAvailableB) return 1;
                if (!isNotAvailableA && isNotAvailableB) return -1;
                if (isNotAvailableA && isNotAvailableB) return 0;

                const priceA = extractPrice(priceTextA);
                const priceB = extractPrice(priceTextB);
                return priceB - priceA;

            case 'cost-asc':
                const priceTextA2 = a.querySelector('.recipe-price').textContent;
                const priceTextB2 = b.querySelector('.recipe-price').textContent;
                const isNotAvailableA2 = priceTextA2.includes('Not available');
                const isNotAvailableB2 = priceTextB2.includes('Not available');

                // Put "Not available" items at the end
                if (isNotAvailableA2 && !isNotAvailableB2) return 1;
                if (!isNotAvailableA2 && isNotAvailableB2) return -1;
                if (isNotAvailableA2 && isNotAvailableB2) return 0;

                const priceA2 = extractPrice(priceTextA2);
                const priceB2 = extractPrice(priceTextB2);
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
async function showCrossServerComparison(recipeId, recipeName = null) {
    const comparisonContent = document.getElementById('comparison-content');

    // Show loading state
    comparisonContent.innerHTML = '<div class="loading-message">🔍 Loading cross-server pricing...</div>';

    try {
        // Get user's region (assuming 'us' for now, could be made dynamic)
        const userRegion = 'us';

        const response = await fetch(`/api/cross-server/price-comparison/${recipeId}/${userRegion}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error('API request was not successful');
        }

        // Add recipe name to the data if provided
        if (recipeName) {
            data.recipeName = recipeName;
        }

        // Display cross-server comparison
        displayCrossServerComparison(data);

    } catch (error) {
        console.error('Error loading cross-server comparison:', error);
        comparisonContent.innerHTML = `
            <div class="error-message">
                ❌ Failed to load cross-server pricing: ${error.message}
            </div>
        `;
    }
}

// Display cross-server price comparison data
function displayCrossServerComparison(data) {
    const comparisonContent = document.getElementById('comparison-content');

    if (!data.priceComparison || data.priceComparison.length === 0) {
        comparisonContent.innerHTML = `
            <div class="no-data-message">
                📭 No auction house data found for this recipe across any servers in ${data.region.toUpperCase()}.
            </div>
        `;
        return;
    }

    const cheapest = data.cheapestRealm;
    const totalRealms = data.totalRealms;

    const displayTitle = data.recipeName ? data.recipeName : `Recipe ID: ${data.itemId}`;

    let html = `
        <div class="comparison-header">
            <h4>${displayTitle} - Found on ${totalRealms} server${totalRealms !== 1 ? 's' : ''}</h4>
            ${cheapest ? `<div class="cheapest-highlight">💰 Cheapest: ${formatGold(cheapest.lowest_price)} on ${cheapest.realm_names}</div>` : ''}
        </div>
        <div class="comparison-table">
            <div class="comparison-header-row">
                <div class="realm-col">Server(s)</div>
                <div class="price-col">Lowest Price</div>
                <div class="avg-col">Avg Price</div>
                <div class="quantity-col">Available</div>
                <div class="updated-col">Last Updated</div>
            </div>
    `;

    data.priceComparison.forEach((realm, index) => {
        const isCheapest = index === 0;
        const updatedTime = new Date(realm.last_updated).toLocaleString();

        html += `
            <div class="comparison-row ${isCheapest ? 'cheapest-row' : ''}">
                <div class="realm-col">${realm.realm_names}</div>
                <div class="price-col">${formatGold(realm.lowest_price)}</div>
                <div class="avg-col">${formatGold(realm.avg_price)}</div>
                <div class="quantity-col">${realm.total_quantity} (${realm.auction_count} auctions)</div>
                <div class="updated-col">${updatedTime}</div>
            </div>
        `;
    });

    html += '</div>';
    comparisonContent.innerHTML = html;
}

// Collection Analytics Functions
async function loadCollectionAnalytics() {
    try {
        await displayCollectionAnalytics();
    } catch (error) {
        console.error('Error loading collection analytics:', error);
        const overview = document.getElementById('analytics-overview');
        overview.innerHTML = '<div class="analytics-loading">Unable to load collection analytics</div>';
    }
}

async function displayCollectionAnalytics() {
    const overview = document.getElementById('analytics-overview');
    const details = document.getElementById('analytics-details');

    try {
        const stats = await calculateCurrentCollectionStats();
        if (currentProfession) {
            console.log('✅ Loading analytics for profession:', currentProfession);
            displayProfessionAnalyticsOverview(currentProfession, stats);
            updateSummaryCard(currentProfession);
            updateVelocityCard(null);
            updateProjectionCard(null);
        } else {
            displayAnalyticsOverview(stats);
            displayOverallAnalytics(stats.professionStats);
        }

        details.style.display = 'block';
    } catch (error) {
        console.error('Error displaying analytics:', error);
        overview.innerHTML = '<div class="analytics-loading">Error loading analytics data</div>';
    }
}

async function calculateCurrentCollectionStats() {
    // console.log('🔍 calculateCurrentCollectionStats - professionsData:', professionsData);
    // console.log('🔍 calculateCurrentCollectionStats - professionsData keys:', Object.keys(professionsData || {}));
    // console.log('🔍 First tier structure:', professionsData[0]);
    // console.log('🔍 First tier field names:', professionsData[0] ? Object.keys(professionsData[0]) : 'No first tier');

    if (!professionsData || Object.keys(professionsData).length === 0) {
        console.log('⚠️ No professionsData available for analytics');
        return {
            overallStats: { totalProfessions: 0, totalRecipes: 0, totalCollected: 0, overallCompletion: 0 },
            professionStats: []
        };
    }

    const professionStats = [];
    let totalRecipes = 0;
    let totalCollected = 0;

    // professionsData is an array of individual tiers, not grouped professions
    // Group by profession name and sum up tiers
    const professionGroups = {};

    for (const tier of professionsData) {
        if (tier && tier.profession_name && tier.total_recipes_available !== undefined) {
            const profName = tier.profession_name;

            if (!professionGroups[profName]) {
                professionGroups[profName] = {
                    totalRecipes: 0,
                    knownRecipes: 0
                };
            }

            professionGroups[profName].totalRecipes += tier.total_recipes_available || 0;
            professionGroups[profName].knownRecipes += tier.total_recipes_known || 0;
        }
    }

    console.log('✅ Analytics: Found data for professions:', Object.keys(professionGroups));

    // Convert groups to stats array
    for (const [professionName, data] of Object.entries(professionGroups)) {
        const completionPercentage = data.totalRecipes > 0 ? (data.knownRecipes / data.totalRecipes * 100) : 0;
        professionStats.push({
            category: professionName,
            total_possible: data.totalRecipes,
            total_collected: data.knownRecipes,
            completion_percentage: completionPercentage
        });

        totalRecipes += data.totalRecipes;
        totalCollected += data.knownRecipes;
    }

    const overallCompletion = totalRecipes > 0 ? (totalCollected / totalRecipes * 100) : 0;
    return {
        overallStats: {
            totalProfessions: professionStats.length,
            totalRecipes,
            totalCollected,
            overallCompletion: Math.round(overallCompletion * 100) / 100
        },
        professionStats
    };
}

function displayAnalyticsOverview(stats) {
    const overview = document.getElementById('analytics-overview');
    overview.innerHTML = `
        <div class="overview-stats">
            <div class="overview-stat">
                <span class="overview-stat-value">${stats.overallStats.totalProfessions}</span>
                <div class="overview-stat-label">Professions Tracked</div>
            </div>
            <div class="overview-stat">
                <span class="overview-stat-value">${stats.overallStats.totalRecipes}</span>
                <div class="overview-stat-label">Total Recipes</div>
            </div>
            <div class="overview-stat">
                <span class="overview-stat-value">${stats.overallStats.totalCollected}</span>
                <div class="overview-stat-label">Recipes Known</div>
            </div>
            <div class="overview-stat">
                <span class="overview-stat-value">${stats.overallStats.overallCompletion}%</span>
                <div class="overview-stat-label">Overall Progress</div>
            </div>
        </div>
    `;
}

function displayProfessionAnalyticsOverview(professionName, stats) {
    const overview = document.getElementById('analytics-overview');

    // Find the specific profession stats
    const professionStats = stats.professionStats.find(p => p.category === professionName);

    if (!professionStats) {
        overview.innerHTML = '<div class="analytics-loading">No data available for this profession</div>';
        return;
    }

    // Count characters with this profession
    const charactersWithProfession = userCharacters.filter(char => {
        if (!char.professions_list) return false;
        try {
            const professions = JSON.parse(char.professions_list);
            return professions.some(prof => prof.name && prof.name.toLowerCase() === professionName.toLowerCase());
        } catch (e) {
            return false;
        }
    }).length;

    const missingRecipes = professionStats.total_possible - professionStats.total_collected;

    overview.innerHTML = `
        <div class="overview-stats">
            <div class="overview-stat">
                <span class="overview-stat-value">${charactersWithProfession}</span>
                <div class="overview-stat-label">Characters with ${professionName.charAt(0).toUpperCase() + professionName.slice(1)}</div>
            </div>
            <div class="overview-stat">
                <span class="overview-stat-value">${professionStats.total_possible}</span>
                <div class="overview-stat-label">Total Recipes</div>
            </div>
            <div class="overview-stat">
                <span class="overview-stat-value">${missingRecipes}</span>
                <div class="overview-stat-label">Missing Recipes</div>
            </div>
            <div class="overview-stat">
                <span class="overview-stat-value">${Math.round(professionStats.completion_percentage)}%</span>
                <div class="overview-stat-label">Completion</div>
            </div>
        </div>
    `;
}

function updateSummaryCard(professionName) {
    const totalRecipesElement = document.getElementById('total-recipes');
    const collectedRecipesElement = document.getElementById('collected-recipes');
    const progressFillElement = document.getElementById('progress-fill');
    const progressTextElement = document.getElementById('progress-text');

    if (!professionName) {
        totalRecipesElement.textContent = '-';
        collectedRecipesElement.textContent = '-';
        progressFillElement.style.width = '0%';
        progressTextElement.textContent = '0%';
        return;
    }

    // Find all tiers for this profession (same logic as working profession planning code)
    const professionTiers = professionsData.filter(tier =>
        tier.profession_name && tier.profession_name.toLowerCase() === professionName.toLowerCase()
    );

    if (professionTiers.length === 0) {
        totalRecipesElement.textContent = '-';
        collectedRecipesElement.textContent = '-';
        progressFillElement.style.width = '0%';
        progressTextElement.textContent = '0%';
        return;
    }

    let totalRecipes = 0;
    let knownRecipes = 0;

    for (const tier of professionTiers) {
        if (tier.total_recipes_available !== undefined) {
            totalRecipes += tier.total_recipes_available || 0;
            knownRecipes += tier.total_recipes_known || 0;
        }
    }

    const completionPercentage = totalRecipes > 0 ? Math.round((knownRecipes / totalRecipes) * 100) : 0;

    totalRecipesElement.textContent = totalRecipes.toLocaleString();
    collectedRecipesElement.textContent = knownRecipes.toLocaleString();
    progressFillElement.style.width = `${completionPercentage}%`;
    progressTextElement.textContent = `${completionPercentage}%`;
}

function updateVelocityCard(velocityData) {
    const weeklyElement = document.getElementById('velocity-weekly');
    const monthlyElement = document.getElementById('velocity-monthly');
    const trendElement = document.getElementById('velocity-trend');

    if (!velocityData) {
        weeklyElement.textContent = 'No data';
        monthlyElement.textContent = 'No data';
        trendElement.innerHTML = '<em>📈 Velocity tracking requires historical data. Use the profession planner regularly and check back in a few days to see your learning trends!</em>';
        trendElement.className = 'velocity-trend-placeholder';
        return;
    }

    weeklyElement.textContent = `${velocityData.weekly || 0} recipes/week`;
    monthlyElement.textContent = `${velocityData.monthly || 0} recipes/month`;

    if (velocityData.trend === 'increasing') {
        trendElement.innerHTML = '📈 <span class="trend-increasing">Accelerating progress</span>';
    } else if (velocityData.trend === 'decreasing') {
        trendElement.innerHTML = '📉 <span class="trend-decreasing">Slowing progress</span>';
    } else {
        trendElement.innerHTML = '➡️ <span class="trend-stable">Steady progress</span>';
    }
}

function updateProjectionCard(projectionData) {
    const currentProgressElement = document.getElementById('current-progress');
    const estimatedCompletionElement = document.getElementById('estimated-completion');
    const projectionConfidenceElement = document.getElementById('projection-confidence');

    if (!projectionData) {
        currentProgressElement.textContent = '-';
        estimatedCompletionElement.textContent = 'No data';
        projectionConfidenceElement.innerHTML = '<em>🎯 Completion projections require tracking your recipe learning over time. Keep using the planner to build this data!</em>';
        projectionConfidenceElement.className = 'projection-confidence-placeholder';
        return;
    }

    currentProgressElement.textContent = `${projectionData.current_percentage || 0}%`;

    if (projectionData.estimated_completion_date) {
        const completionDate = new Date(projectionData.estimated_completion_date);
        estimatedCompletionElement.textContent = completionDate.toLocaleDateString();
    } else {
        estimatedCompletionElement.textContent = 'Unknown';
    }

    const confidence = projectionData.confidence_level || 'low';
    const confidenceText = confidence === 'high' ? 'High confidence' :
                          confidence === 'medium' ? 'Medium confidence' : 'Low confidence';
    projectionConfidenceElement.innerHTML = `📊 ${confidenceText} projection`;
    projectionConfidenceElement.className = `projection-confidence-${confidence}`;
}

function displayOverallAnalytics(professionStats) {
    updateVelocityCard(null);
    updateProjectionCard(null);

    const totalRecipesElement = document.getElementById('total-recipes');
    const collectedRecipesElement = document.getElementById('collected-recipes');
    const progressFillElement = document.getElementById('progress-fill');
    const progressTextElement = document.getElementById('progress-text');

    const totalRecipes = professionStats.reduce((sum, prof) => sum + prof.total_possible, 0);
    const totalCollected = professionStats.reduce((sum, prof) => sum + prof.total_collected, 0);
    const overallCompletion = totalRecipes > 0 ? Math.round((totalCollected / totalRecipes) * 100) : 0;

    totalRecipesElement.textContent = totalRecipes.toLocaleString();
    collectedRecipesElement.textContent = totalCollected.toLocaleString();
    progressFillElement.style.width = `${overallCompletion}%`;
    progressTextElement.textContent = `${overallCompletion}%`;
}

async function updateProfessionAnalytics(professionName) {
    try {
        const stats = await calculateCurrentCollectionStats();
        console.log('🔄 Updating profession analytics for:', professionName);

        // Update the overview section with profession-specific data
        displayProfessionAnalyticsOverview(professionName, stats);

        // Update individual cards
        updateSummaryCard(professionName);
        updateVelocityCard(null);
        updateProjectionCard(null);
    } catch (error) {
        console.error('Error updating profession analytics:', error);
    }
}
