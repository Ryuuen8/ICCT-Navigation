document.addEventListener('DOMContentLoaded', () => {
    const navigateBtn = document.querySelector('.action-card.navigate');
    const emergencyBtn = document.querySelector('.action-card.emergency');
    const floorBtn = document.getElementById('floor-btn');
    var popup = document.getElementById("test");
    const closePopupBtn = document.getElementById('closePopupBtn');
    const fromInput = document.getElementById('fmFromInput');
    const toInput = document.getElementById('fmToInput');
    const fromSelectedLocation = document.getElementById('fmFromSelectedLocation');
    const toSelectedLocation = document.getElementById('fmToSelectedLocation');
    const listLocation = document.querySelectorAll('#location-list li');
    const floorOptions = document.querySelectorAll('.popup-floor-card');
    const searchNavButton = document.getElementById('navigate-btn');
    const announcementBtn = document.getElementById('announcement-btn');
    const announcementPopup = document.getElementById('announcementPopup');
    const closeAnnouncementBtn = document.getElementById('closeAnnouncementBtn');
    const announcementOkBtn = document.getElementById('announcementOkBtn');
    const annNavigate = document.querySelectorAll('.ann-btn-navigate');
    const annCheck = document.querySelectorAll('.ann-btn-location');
    const hazardBtn = document.querySelector('.quick-item:has(.fa-triangle-exclamation)');
    const hazardPopup = document.getElementById('hazardPopup');
    const closeHazardBtn = document.getElementById('closeHazardBtn');
    const hazardCancelBtn = document.getElementById('hazardCancelBtn');
    const hazardSubmitBtn = document.getElementById('hazardSubmitBtn');
    const assemblyBtn = document.querySelector('.quick-item:has(.fa-people-group)');
    const assemblyPopup = document.getElementById('assemblyPopup');
    const closeAssemblyBtn = document.getElementById('closeAssemblyBtn');
    const assemblyOkBtn = document.getElementById('assemblyOkBtn');
    const contactBtn = document.querySelector('.quick-item:has(.fa-phone)');
    const contactPopup = document.getElementById('contactPopup');
    const closeContactBtn = document.getElementById('closeContactBtn');
    const contactOkBtn = document.getElementById('contactOkBtn');
    const safetyBtn = document.querySelector('.quick-item:has(.fa-shield-heart)');
    const safetyPopup = document.getElementById('safetyPopup');
    const closeSafetyBtn = document.getElementById('closeSafetyBtn');
    const safetyOkBtn = document.getElementById('safetyOkBtn');

    let activeSearchField = 'from';
    let fromSelected = '';
    let toSelected = '';


    function normalizeFloorValue(value) {
        if (value === null || value === undefined) {
            return null;
        }

        const normalized = String(value).trim().toLowerCase();

        if (normalized === 'g') {
            return '1';
        }

        return normalized;
    }

    if (hazardBtn && hazardPopup) {
        hazardBtn.addEventListener('click', () => {
            hazardPopup.classList.add('show');
            hazardPopup.setAttribute('aria-hidden', 'false');
        });
    }

    [closeHazardBtn, hazardCancelBtn].forEach(btn => {
        btn?.addEventListener('click', () => {
            hazardPopup.classList.remove('show');
            hazardPopup.setAttribute('aria-hidden', 'true');
        });
    });

    hazardPopup?.addEventListener('click', (e) => {
        if (e.target === hazardPopup) {
            hazardPopup.classList.remove('show');
            hazardPopup.setAttribute('aria-hidden', 'true');
        }
    });

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

    if (announcementBtn && announcementPopup) {
        announcementBtn.addEventListener('click', () => {
            announcementPopup.classList.add('show');
            announcementPopup.setAttribute('aria-hidden', 'false');
        });
    }

    if (closeAnnouncementBtn && announcementPopup) {
        closeAnnouncementBtn.addEventListener('click', () => {
            announcementPopup.classList.remove('show');
            announcementPopup.setAttribute('aria-hidden', 'true');
        });
    }

    if (announcementOkBtn && announcementPopup) {
        announcementOkBtn.addEventListener('click', () => {
            announcementPopup.classList.remove('show');
            announcementPopup.setAttribute('aria-hidden', 'true');
        });
    }

    if (announcementPopup) {
        announcementPopup.addEventListener('click', (e) => {
            if (e.target === announcementPopup) {
                announcementPopup.classList.remove('show');
                announcementPopup.setAttribute('aria-hidden', 'true');
            }
        });
    }

    // Handle floor selection
    floorOptions.forEach(option => {
        option.addEventListener('click', () => {
            const floor = normalizeFloorValue(option.getAttribute('data-floor'));

            if (!floor) {
                return;
            }

            window.location.href = `/map/?floor=${encodeURIComponent(floor)}`;
        });
    });

    function showError(message, title = "Navigation Error") {

        // Remove existing popup
        const existing = document.getElementById("custom-error-popup");
        if (existing) existing.remove();

        // Overlay
        const overlay = document.createElement("div");
        overlay.id = "custom-error-popup";

        Object.assign(overlay.style, {
            position: "fixed",
            inset: "0",
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: "99999"
        });

        // Popup box
        const popup = document.createElement("div");

        Object.assign(popup.style, {
            width: "320px",
            maxWidth: "90%",
            background: "#fff",
            borderRadius: "20px",
            padding: "25px",
            textAlign: "center",
            boxShadow: "0 10px 35px rgba(0,0,0,0.2)",
            fontFamily: "Arial, sans-serif"
        });

        popup.innerHTML = `
            <div style="font-size:48px;margin-bottom:15px;">⚠️</div>

            <h3 style="
                margin:0;
                color:#E53935;
                font-size:22px;
            ">
                ${title}
            </h3>

            <p style="
                margin:15px 0 25px;
                color:#555;
                line-height:1.5;
            ">
                ${message}
            </p>

            <button id="popup-ok-btn" style="
                border:none;
                background:#00E5FF;
                color:#000;
                padding:12px 28px;
                border-radius:12px;
                cursor:pointer;
                font-weight:600;
                font-size:15px;
            ">
                OK
            </button>
    `;

        overlay.appendChild(popup);
        document.body.appendChild(overlay);

        // Close button
        document.getElementById("popup-ok-btn")
            .addEventListener("click", () => {
                overlay.remove();
            });

        // Close when clicking outside
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });
    }

    if (fromInput && toInput && searchNavButton && listLocation.length > 0) {
        fromInput.addEventListener('focus', () => {
            activeSearchField = 'from';
        });

        toInput.addEventListener('focus', () => {
            activeSearchField = 'to';
        });

        fromInput.addEventListener('input', function () {
            const fromSearchTerm = this.value.trim().toLowerCase();

            listLocation.forEach(item => {
                const fromText = item.textContent.toLowerCase();
                if (fromText.includes(fromSearchTerm)) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
        });

        listLocation.forEach(item => {
            item.addEventListener('click', function () {
                const clickedName = this.dataset.name?.trim() || '';
                const clickedLabel = clickedName || (this.querySelector('.fm-dest-name span')?.textContent.trim() || this.textContent.trim());

                if (activeSearchField === 'to') {
                    toSelected = clickedName;
                    toInput.value = clickedLabel;

                    if (toSelectedLocation) {
                        toSelectedLocation.textContent = `Selected location: ${clickedLabel}`;
                    }
                } else {
                    fromSelected = clickedName;
                    fromInput.value = clickedLabel;

                    if (fromSelectedLocation) {
                        fromSelectedLocation.textContent = `Selected location: ${clickedLabel}`;
                    }
                }
            });
        });

        searchNavButton.addEventListener('click', function () {
            if (fromSelected && toSelected) {
                window.location.href =
                    `/map/?start=${encodeURIComponent(fromSelected)}&end=${encodeURIComponent(toSelected)}`;
            }
        });
    }
    annNavigate.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const fromLocation = btn.dataset.fromLocationName;
            const toLocation = btn.dataset.toLocationName;
            window.location.href = `/map/?start=${encodeURIComponent(fromLocation)}&end=${encodeURIComponent(toLocation)}`;
        });
    });

    annCheck.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const locationName = btn.dataset.locationName;
            const locationFloor = btn.dataset.locationFloor;
            const locationX = btn.dataset.locationX;
            const locationY = btn.dataset.locationY;
            window.location.href = `/map/?x=${encodeURIComponent(locationX)}&y=${encodeURIComponent(locationY)}&floor=${encodeURIComponent(locationFloor)}&name=${encodeURIComponent(locationName)}`;
        });
    });
    assemblyBtn?.addEventListener('click', () => {
        assemblyPopup.classList.add('show');
        assemblyPopup.setAttribute('aria-hidden', 'false');
    });
    [closeAssemblyBtn, assemblyOkBtn].forEach(btn => {
        btn?.addEventListener('click', () => {
            assemblyPopup.classList.remove('show');
            assemblyPopup.setAttribute('aria-hidden', 'true');
        });
    });
    assemblyPopup?.addEventListener('click', e => {
        if (e.target === assemblyPopup) {
            assemblyPopup.classList.remove('show');
            assemblyPopup.setAttribute('aria-hidden', 'true');
        }
    });
    safetyBtn?.addEventListener('click', () => {
        safetyPopup.classList.add('show');
        safetyPopup.setAttribute('aria-hidden', 'false');
    });
    [closeSafetyBtn, safetyOkBtn].forEach(btn => {
        btn?.addEventListener('click', () => {
            safetyPopup.classList.remove('show');
            safetyPopup.setAttribute('aria-hidden', 'true');
        });
    });
    safetyPopup?.addEventListener('click', e => {
        if (e.target === safetyPopup) {
            safetyPopup.classList.remove('show');
            safetyPopup.setAttribute('aria-hidden', 'true');
        }
    });
    contactBtn?.addEventListener('click', () => {
        contactPopup.classList.add('show');
        contactPopup.setAttribute('aria-hidden', 'false');
    });
    [closeContactBtn, contactOkBtn].forEach(btn => {
        btn?.addEventListener('click', () => {
            contactPopup.classList.remove('show');
            contactPopup.setAttribute('aria-hidden', 'true');
        });
    });
    contactPopup?.addEventListener('click', e => {
        if (e.target === contactPopup) {
            contactPopup.classList.remove('show');
            contactPopup.setAttribute('aria-hidden', 'true');
        }
    });
});

