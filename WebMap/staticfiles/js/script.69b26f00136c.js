document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("floorBtn");
    const menu = document.getElementById("floorMenu");
    const floorItems = menu ? menu.querySelectorAll(".floor-item") : [];

    if (!btn || !menu) {
        console.error("Floor dropdown elements not found!");
        return;
    }

    // --- Toggle dropdown ---
    btn.addEventListener("click", (e) => {
        e.stopPropagation(); // prevents instant close bug

        const isOpen = menu.classList.toggle("show");
        btn.setAttribute("aria-expanded", String(isOpen));
    });

    // --- Floor selection handler with map integration ---
    floorItems.forEach((item) => {
        item.addEventListener("click", function (e) {
            e.stopPropagation();

            const floor = parseInt(this.dataset.floor, 10);

            // Switch floor using the map's switchFloor function
            if (typeof window.switchFloor === 'function') {
                window.switchFloor(floor);
            } else if (typeof switchFloor === 'function') {
                // Fallback to local switchFloor if available
                switchFloor(floor);
            } else {
                console.warn('switchFloor function not found');
                // Try to find and use the map's floor switching logic
                if (typeof map !== 'undefined' && typeof floors !== 'undefined') {
                    // Direct implementation as fallback
                    if (floors[floor]) {
                        const previousFloor = currentFloor;

                        if (floors[previousFloor]) {
                            map.removeLayer(floors[previousFloor].image);
                            map.removeLayer(floors[previousFloor].layer);
                        }

                        if (typeof currentPathLayers !== 'undefined') {
                            currentPathLayers.forEach((layer) => {
                                if (map.hasLayer(layer)) {
                                    map.removeLayer(layer);
                                }
                            });
                        }

                        currentFloor = floor;

                        map.addLayer(floors[currentFloor].image);
                        map.addLayer(floors[currentFloor].layer);

                        if (typeof fitCurrentFloor === 'function') {
                            fitCurrentFloor();
                        }

                        if (typeof currentPathLayers !== 'undefined') {
                            currentPathLayers.forEach((layer) => {
                                if (layer.segmentFloor === currentFloor) {
                                    map.addLayer(layer);
                                }
                            });
                        }
                    }
                }
            }

            // Close dropdown after selection
            menu.classList.remove("show");
            btn.setAttribute("aria-expanded", "false");

            // Update active state
            updateActiveFloor(floor);
        });
    });

    // --- Close dropdown when clicking outside ---
    document.addEventListener("click", (e) => {
        if (!menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.remove("show");
            btn.setAttribute("aria-expanded", "false");
        }
    });

    // --- Update active floor in dropdown ---
    function updateActiveFloor(floor) {
        floorItems.forEach((item) => {
            const floorNum = parseInt(item.dataset.floor, 10);
            if (floorNum === floor) {
                item.classList.add('active');
                item.setAttribute('aria-current', 'true');
            } else {
                item.classList.remove('active');
                item.removeAttribute('aria-current');
            }
        });

        // Update the button text to show current floor
        const floorSpan = btn.querySelector('.floors');
        if (floorSpan) {
            let displayLabel = floor === 1 ? 'G' : `F${floor}`;
            floorSpan.textContent = displayLabel;
        }
    }

    // Expose the update function globally
    window.updateFloorDropdown = updateActiveFloor;

    // Initialize with current floor (if map is already loaded)
    if (typeof currentFloor !== 'undefined') {
        updateActiveFloor(currentFloor);
    }

    // Listen for floor changes from map.js
    document.addEventListener('floorChanged', (e) => {
        if (e.detail && e.detail.floor) {
            updateActiveFloor(e.detail.floor);
        }
    });
    // only show 2B button when on floor 2
    document.querySelectorAll('.floor-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const floor = parseInt(btn.dataset.floor);
            switchFloor(floor);

            // show 2B only when on floor 2 or 2B
            const sectionBtn = document.querySelector('[data-floor="21"]');
            if (sectionBtn) {
                sectionBtn.style.display = [2, 21].includes(floor) ? 'flex' : 'none';
            }
        });
    });

    // hide 2B on initial load if not on floor 2
    document.addEventListener('DOMContentLoaded', () => {
        const sectionBtn = document.querySelector('[data-floor="21"]');
        if (sectionBtn && ![2, 21].includes(currentFloor)) {
            sectionBtn.style.display = 'none';
        }
    });
});