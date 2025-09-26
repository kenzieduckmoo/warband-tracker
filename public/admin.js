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

async function populateQuestCache() {
    clearResults();
    const button = document.getElementById('populate-quest-cache-btn');

    if (!button) return;

    button.disabled = true;
    button.innerHTML = '<span style="animation: spin 1s linear infinite; display: inline-block;">⟲</span> Starting...';

    try {
        showMessage('Starting quest cache population... This will scan all your characters.', 'info');
        const response = await fetch('/api/populate-quest-cache', { method: 'POST' });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.success && result.jobId) {
            showMessage(`Quest cache job queued successfully! Job ID: ${result.jobId}`, 'success');

            // Start polling for job status
            await pollJobStatus(result.jobId, button);
        } else {
            throw new Error(result.error || 'Failed to start quest cache population');
        }
    } catch (error) {
        showMessage('Failed to populate quest cache: ' + error.message, 'error');
        button.innerHTML = '📚 Populate Quest Cache';
        button.disabled = false;
    }
}

async function pollJobStatus(jobId, button) {
    let pollCount = 0;
    const maxPolls = 300; // 5 minutes max polling

    const poll = async () => {
        try {
            const response = await fetch(`/api/quest-cache-status/${jobId}`);
            if (!response.ok) {
                throw new Error('Failed to get job status');
            }

            const job = await response.json();
            updateJobProgress(job, button);

            if (job.status === 'completed') {
                showMessage(
                    `Quest cache populated successfully! ` +
                    `Processed ${job.progress.charactersProcessed}/${job.progress.totalCharacters} characters, ` +
                    `${job.progress.questsProcessed} quests discovered, ` +
                    `${job.progress.questsContributed} contributed to shared database.`,
                    'success'
                );
                button.innerHTML = '📚 Populate Quest Cache';
                button.disabled = false;
                return;
            } else if (job.status === 'failed') {
                showMessage(`Quest cache job failed: ${job.error}`, 'error');
                button.innerHTML = '📚 Populate Quest Cache';
                button.disabled = false;
                return;
            } else if (pollCount >= maxPolls) {
                showMessage('Job status polling timed out. Job may still be running in background.', 'error');
                button.innerHTML = '📚 Populate Quest Cache';
                button.disabled = false;
                return;
            }

            pollCount++;
            setTimeout(poll, 1000);
        } catch (error) {
            showMessage('Lost connection to job status. Job may still be running in background.', 'error');
            button.innerHTML = '📚 Populate Quest Cache';
            button.disabled = false;
        }
    };

    setTimeout(poll, 1000);
}

function updateJobProgress(job, button) {
    let progressText = '';
    let progressPercent = 0;

    switch (job.status) {
        case 'queued':
            progressText = `Queued (Position: ${job.queuePosition})`;
            break;
        case 'processing':
            switch (job.progress.phase) {
                case 'starting':
                    progressText = 'Starting...';
                    progressPercent = 5;
                    break;
                case 'fetching_characters':
                    progressText = 'Loading characters...';
                    progressPercent = 10;
                    break;
                case 'processing_characters':
                    const charPercent = job.progress.totalCharacters > 0 ?
                        Math.round((job.progress.charactersProcessed / job.progress.totalCharacters) * 70) : 0;
                    progressText = `Processing (${job.progress.charactersProcessed}/${job.progress.totalCharacters})`;
                    progressPercent = 15 + charPercent;
                    break;
                case 'updating_summaries':
                    progressText = 'Updating zone summaries...';
                    progressPercent = 90;
                    break;
                case 'triggering_discovery':
                    progressText = 'Starting background discovery...';
                    progressPercent = 95;
                    break;
            }
            break;
        case 'completed':
            progressText = 'Completed!';
            progressPercent = 100;
            break;
        case 'failed':
            progressText = 'Failed';
            break;
    }

    button.innerHTML = `⟲ ${progressText}${progressPercent > 0 ? ` (${progressPercent}%)` : ''}`;
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

// Auction House Management Functions
async function updateAuctionData() {
    clearResults();
    try {
        showMessage('Starting auction data update for all realms... This may take a few minutes.', 'info');
        const response = await fetch('/api/admin/update-auction-house', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showMessage(`Auction data updated successfully! Processed ${data.realmsUpdated} realms.`, 'success');
            if (data.details) {
                showCodeBlock('Update Details', JSON.stringify(data.details, null, 2));
            }
        } else {
            showMessage('Failed to update auction data: ' + data.error, 'error');
        }
    } catch (error) {
        showMessage('Failed to update auction data: ' + error.message, 'error');
    }
}

async function checkAuctionStatus() {
    clearResults();
    try {
        const response = await fetch('/api/admin/auction-house-status');
        const data = await response.json();

        showCodeBlock('Auction House Status', JSON.stringify(data, null, 2));

        if (data.success) {
            showMessage(`Status retrieved: ${data.realmsWithData} realms have auction data`, 'info');
        } else {
            showMessage('Failed to retrieve auction status', 'error');
        }
    } catch (error) {
        showMessage('Failed to check auction status: ' + error.message, 'error');
    }
}

async function cleanupAuctionData() {
    clearResults();
    try {
        showMessage('Cleaning up old auction data...', 'info');
        const response = await fetch('/api/admin/cleanup-auction-data', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showMessage(`Cleanup completed! Removed ${data.recordsRemoved} old auction records.`, 'success');
        } else {
            showMessage('Failed to cleanup auction data: ' + data.error, 'error');
        }
    } catch (error) {
        showMessage('Failed to cleanup auction data: ' + error.message, 'error');
    }
}

async function viewProfessionMains() {
    clearResults();
    try {
        const response = await fetch('/api/profession-mains');
        const data = await response.json();

        showCodeBlock('Profession Main Assignments', JSON.stringify(data, null, 2));

        if (data.success) {
            const assignments = data.assignments || [];
            showMessage(`Found ${assignments.length} profession main assignments`, 'info');
        } else {
            showMessage('Failed to retrieve profession mains', 'error');
        }
    } catch (error) {
        showMessage('Failed to view profession mains: ' + error.message, 'error');
    }
}

async function aggregatePriceHistory() {
    clearResults();
    try {
        showMessage('Aggregating price history data... This may take a moment.', 'info');
        const response = await fetch('/api/admin/aggregate-price-history', { method: 'POST' });
        const data = await response.json();

        if (data.success) {
            showMessage(`Price history aggregation completed! Processed ${data.recordsProcessed} records.`, 'success');
            showCodeBlock('Aggregation Results', JSON.stringify(data, null, 2));
        } else {
            showMessage('Failed to aggregate price history: ' + data.error, 'error');
        }
    } catch (error) {
        showMessage('Failed to aggregate price history: ' + error.message, 'error');
    }
}

async function checkApiStatus() {
    clearResults();
    try {
        // Check multiple endpoints to verify system health
        const checks = [
            { name: 'Changelog API', url: '/api/changelog' },
            { name: 'Token API', url: '/api/wow-token' },
            { name: 'Profession Mains API', url: '/api/profession-mains' }
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
    document.getElementById('populate-quest-cache-btn')?.addEventListener('click', populateQuestCache);
    document.getElementById('quest-discovery-btn')?.addEventListener('click', checkQuestDiscovery);

    document.getElementById('update-auctions-btn')?.addEventListener('click', updateAuctionData);
    document.getElementById('auction-status-btn')?.addEventListener('click', checkAuctionStatus);
    document.getElementById('cleanup-auctions-btn')?.addEventListener('click', cleanupAuctionData);
    document.getElementById('profession-mains-btn')?.addEventListener('click', viewProfessionMains);
    document.getElementById('aggregate-price-history-btn')?.addEventListener('click', aggregatePriceHistory);

    document.getElementById('view-logs-btn')?.addEventListener('click', viewLogs);
    document.getElementById('api-status-btn')?.addEventListener('click', checkApiStatus);

    showMessage('Admin panel loaded successfully', 'success');
});