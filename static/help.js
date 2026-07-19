// Add click listeners to all FAQ questions for collapsible accordion logic
(function() {
    const faqQuestions = document.querySelectorAll('.faq-question');
    
    faqQuestions.forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.faq-item');
            if (item) {
                item.classList.toggle('open');
            }
        });
    });
})();
