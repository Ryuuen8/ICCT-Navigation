document.addEventListener('DOMContentLoaded', () => {
    const navigateBtn = document.querySelector('.action-card.navigate');
    const emergencyBtn = document.querySelector('.action-card.emergency');
    const floorBtn = document.getElementById('floor-btn');
    var popup = document.getElementById("test");
    const closePopupBtn = document.getElementById('closePopupBtn');

    // Open popup when floor button is clicked
    if (floorBtn) {
        floorBtn.addEventListener('click', () => {
            popup.classList.add("show");
        });
    }

    // Close popup when clicking close button
    if (closePopupBtn) {
        closePopupBtn.addEventListener('click', () => {
            popup.classList.remove("show");
        });
    }

    // Close popup when clicking outside
    if (popup) {
        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                popup.classList.remove("show");
            }
        });
    }

    // Handle floor selection
    const floorOptions = document.querySelectorAll('.floor-option');
    floorOptions.forEach(option => {
        option.addEventListener('click', () => {
            const floor = option.getAttribute('data-floor');
            // Redirect to floormap with floor parameter
            window.location.href = `/floormap/?floor=${floor}`;
        });
    });
});