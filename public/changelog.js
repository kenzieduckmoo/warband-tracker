// Load and display changelog
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const response = await fetch('/api/changelog');
        const data = await response.json();

        renderChangelog(data);
    } catch (error) {
        console.error('Failed to load changelog:', error);
        document.getElementById('changelog-content').innerHTML =
            '<div style="text-align: center; color: var(--text-secondary);">Failed to load changelog</div>';
    }
});

function renderChangelog(data) {
    const container = document.getElementById('changelog-content');
    let html = '';

    // Show unreleased changes if any
    if (data.unreleased && data.unreleased.length > 0) {
        html += `
            <div class="version-card unreleased">
                <div class="version-header">
                    <span class="version-number">
                        Unreleased
                        <span class="unreleased-badge">Coming Soon</span>
                    </span>
                </div>
                <ul class="change-list">
                    ${data.unreleased.map(change => `<li class="change-item">${change}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    // Show released versions
    const releases = Object.entries(data.releases || {})
        .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true })); // Sort by version descending

    releases.forEach(([version, release]) => {
        const typeClass = release.type || 'feature';
        html += `
            <div class="version-card ${typeClass}">
                <div class="version-header">
                    <span class="version-number">v${version}</span>
                    <span class="version-date">${formatDate(release.date)}</span>
                </div>
                ${release.title ? `<div class="version-title">${release.title}</div>` : ''}
                <ul class="change-list">
                    ${(release.changes || []).map(change => `<li class="change-item">${change}</li>`).join('')}
                </ul>
            </div>
        `;
    });

    container.innerHTML = html;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}