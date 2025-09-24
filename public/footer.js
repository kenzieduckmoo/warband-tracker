// Common footer for all pages
document.addEventListener('DOMContentLoaded', function() {
    const footer = document.createElement('footer');
    footer.innerHTML = `
        <div class="footer-content">
            <p>Created by <a href="https://linktr.ee/brandiraine" target="_blank" rel="noopener noreferrer">Kenzie DuckMoo</a></p>
            <p>Powered by Battle.net API | Version 0.3.1</p>
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

    // Style the link
    const link = footerContent.querySelector('a');
    if (link) {
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
    }

    document.body.appendChild(footer);
});