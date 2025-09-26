// Admin Panel JavaScript

// Utility functions
function showMessage(message, type = 'info') {
    const resultsArea = document.getElementById('results-area');
    const messageDiv = document.createElement('div');
    messageDiv.className = `status-message status-${type}`;
    messageDiv.textContent = message;
    resultsArea.appendChild(messageDiv);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.parentNode.removeChild(messageDiv);
        }
    }, 5000);
}

function showCodeBlock(title, content, copyable = true) {
    const resultsArea = document.getElementById('results-area');
    const container = document.createElement('div');
    const codeId = 'code-' + Date.now();
    container.innerHTML = `
        <h4 style="color: var(--text-primary); margin: 20px 0 10px 0;">${title}</h4>
        <div class="code-container">
            <div class="code-block" id="${codeId}">${content}</div>
            ${copyable ? `<button class="copy-button" data-copy-target="${codeId}">Copy</button>` : ''}
        </div>
    `;
    resultsArea.appendChild(container);

    // Add event listener for copy button
    if (copyable) {
        const copyBtn = container.querySelector('.copy-button');
        copyBtn.addEventListener('click', () => copyToClipboard(codeId));
    }
}

function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    const text = element.textContent;
    navigator.clipboard.writeText(text).then(() => {
        showMessage('Copied to clipboard!', 'success');
    }).catch(err => {
        showMessage('Failed to copy to clipboard', 'error');
    });
}

function clearResults() {
    document.getElementById('results-area').innerHTML = '';
}

// Version Management Functions
async function viewVersionInfo() {
    clearResults();
    try {
        const response = await fetch('/api/changelog');
        const data = await response.json();

        showCodeBlock('Current Version Info', JSON.stringify(data, null, 2));
        showMessage(`Current version: ${data.currentVersion} (${data.unreleased.length} unreleased changes)`, 'info');
    } catch (error) {
        showMessage('Failed to load version info: ' + error.message, 'error');
    }
}

function showCreateVersionForm() {
    document.getElementById('version-form').style.display = 'block';
}

function hideCreateVersionForm() {
    document.getElementById('version-form').style.display = 'none';
}

async function createVersion() {
    const version = document.getElementById('version-number').value;
    const title = document.getElementById('version-title').value;
    const type = document.getElementById('version-type').value;

    if (!version || !title) {
        showMessage('Version number and title are required', 'error');
        return;
    }

    try {
        const response = await fetch('/api/create-version', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version, title, type })
        });

        const data = await response.json();

        if (data.success) {
            showMessage(`Version ${version} created successfully!`, 'success');
            showCodeBlock('Discord Post (Ready to Copy & Paste)', data.discordMarkdown);
            hideCreateVersionForm();
            // Clear form
            document.getElementById('version-number').value = '';
            document.getElementById('version-title').value = '';
        } else {
            showMessage('Failed to create version: ' + data.error, 'error');
        }
    } catch (error) {
        showMessage('Failed to create version: ' + error.message, 'error');
    }
}

// Database Management Functions
async function recalculateZoneSummaries() {
    clearResults();
    try {
        showMessage('Recalculating zone summaries...', 'info');
        const response = await fetch('/api/recalculate-zone-summaries', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showMessage('Zone summaries recalculated successfully!', 'success');
        } else {
            showMessage('Failed to recalculate zone summaries', 'error');
        }
    } catch (error) {
        showMessage('Failed to recalculate zone summaries: ' + error.message, 'error');
    }
}

async function debugZoneData() {
    clearResults();
    try {
        const response = await fetch('/api/debug/zone-data');
        const data = await response.json();

        showCodeBlock('Raw Zone Data from cached_quests', JSON.stringify(data, null, 2));
        showMessage(`Found ${data.length} zone/expansion combinations`, 'info');
    } catch (error) {
        showMessage('Failed to load zone debug data: ' + error.message, 'error');
    }
}

async function debugZoneSummary() {
    clearResults();
    try {
        const response = await fetch('/api/debug/zone-summary-table');
        const data = await response.json();

        showCodeBlock('Zone Summary Table Data', JSON.stringify(data, null, 2));
        showMessage(`Found ${data.length} zone summary entries`, 'info');
    } catch (error) {
        showMessage('Failed to load zone summary debug data: ' + error.message, 'error');
    }
}

async function migrateCharacterIds() {
    clearResults();
    try {
        showMessage('Starting character ID migration... This may take a moment.', 'info');
        const response = await fetch('/api/migrate-character-ids', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showMessage('Character ID migration completed successfully!', 'success');
        } else {
            showMessage('Failed to migrate character IDs: ' + data.error, 'error');
        }
    } catch (error) {
        showMessage('Failed to migrate character IDs: ' + error.message, 'error');
    }
}

// Quest & Recipe Management Functions
async function cacheRecipes() {
    clearResults();
    try {
        showMessage('Starting recipe cache update... This may take a few minutes.', 'info');
        const response = await fetch('/api/cache-recipes', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showMessage(`Recipe cache updated! Cached ${data.totalRecipesCached} recipes across ${data.processedProfessions.length} professions.`, 'success');
            showCodeBlock('Processed Professions', data.processedProfessions.join(', '));
        } else {
            showMessage('Failed to cache recipes', 'error');
        }
    } catch (error) {
        showMessage('Failed to cache recipes: ' + error.message, 'error');
    }
}

async function checkQuestDiscovery() {
    clearResults();
    showMessage('Quest discovery status check not implemented yet', 'info');
    // TODO: Add quest discovery status endpoint
}

// System Information Functions
async function viewLogs() {
    clearResults();
    showMessage('Log viewing not implemented yet - check server console', 'info');
    // TODO: Add log viewing endpoint
}

async function checkApiStatus() {
    clearResults();
    try {
        // Check multiple endpoints to verify system health
        const checks = [
            { name: 'Changelog API', url: '/api/changelog' },
            { name: 'Token API', url: '/api/wow-token' }
        ];

        const results = [];
        for (const check of checks) {
            try {
                const response = await fetch(check.url);
                results.push({
                    name: check.name,
                    status: response.ok ? 'OK' : 'FAILED',
                    code: response.status
                });
            } catch (error) {
                results.push({
                    name: check.name,
                    status: 'ERROR',
                    error: error.message
                });
            }
        }

        showCodeBlock('API Status Check Results', JSON.stringify(results, null, 2));

        const allOk = results.every(r => r.status === 'OK');
        showMessage(`System status: ${allOk ? 'All services running normally' : 'Some services may have issues'}`, allOk ? 'success' : 'error');
    } catch (error) {
        showMessage('Failed to check API status: ' + error.message, 'error');
    }
}

// Initialize admin panel
document.addEventListener('DOMContentLoaded', () => {
    // Add event listeners for all buttons
    document.getElementById('view-version-btn')?.addEventListener('click', viewVersionInfo);
    document.getElementById('create-version-btn')?.addEventListener('click', showCreateVersionForm);
    document.getElementById('submit-version-btn')?.addEventListener('click', createVersion);
    document.getElementById('cancel-version-btn')?.addEventListener('click', hideCreateVersionForm);

    document.getElementById('recalc-zones-btn')?.addEventListener('click', recalculateZoneSummaries);
    document.getElementById('debug-zones-btn')?.addEventListener('click', debugZoneData);
    document.getElementById('debug-summary-btn')?.addEventListener('click', debugZoneSummary);
    document.getElementById('migrate-character-ids-btn')?.addEventListener('click', migrateCharacterIds);

    document.getElementById('cache-recipes-btn')?.addEventListener('click', cacheRecipes);
    document.getElementById('quest-discovery-btn')?.addEventListener('click', checkQuestDiscovery);

    document.getElementById('view-logs-btn')?.addEventListener('click', viewLogs);
    document.getElementById('api-status-btn')?.addEventListener('click', checkApiStatus);

    showMessage('Admin panel loaded successfully', 'success');
});