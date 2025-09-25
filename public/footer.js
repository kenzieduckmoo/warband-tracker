// Common footer for all pages
document.addEventListener('DOMContentLoaded', async function() {
    // Load current version from API
    let versionText = '0.3.2';
    try {
        const response = await fetch('/api/changelog');
        const data = await response.json();
        versionText = data.currentVersion;
    } catch (error) {
        console.warn('Failed to load version info:', error);
    }

    const footer = document.createElement('footer');
    footer.innerHTML = `
        <div class="footer-content">
            <p>Created by <a href="https://linktr.ee/brandiraine" target="_blank" rel="noopener noreferrer">Kenzie DuckMoo</a></p>
            <p>Powered by Battle.net API | <a href="/changelog" id="version-link">Version ${versionText}</a></p>
        </div>
    `;
    footer.style.cssText = `
        margin-top: 50px;
        padding: 20px;
        background-color: #1a1a2e;
        color: #eee;
        text-align: center;
        border-top: 2px solid #16213e;
    `;

    // Style the footer content
    const footerContent = footer.querySelector('.footer-content');
    footerContent.style.cssText = `
        max-width: 1200px;
        margin: 0 auto;
    `;

    footerContent.querySelectorAll('p').forEach(p => {
        p.style.cssText = 'margin: 5px 0; font-size: 14px;';
    });

    // Style the links
    const links = footerContent.querySelectorAll('a');
    links.forEach(link => {
        link.style.cssText = `
            color: #00aeff;
            text-decoration: none;
            transition: color 0.3s ease;
        `;

        link.addEventListener('mouseenter', () => {
            link.style.color = '#66ccff';
        });

        link.addEventListener('mouseleave', () => {
            link.style.color = '#00aeff';
        });
    });

    document.body.appendChild(footer);
});