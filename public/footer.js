// Common footer for all pages
document.addEventListener('DOMContentLoaded', function() {
    const footer = document.createElement('footer');
    footer.innerHTML = `
        <div class="footer-content">
            <p>Created by Kenzie DuckMoo</p>
            <p>Powered by Battle.net API | Version 0.2.5</p>
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

    document.body.appendChild(footer);
});