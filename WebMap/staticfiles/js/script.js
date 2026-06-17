document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("floorBtn");
    const menu = document.getElementById("floorMenu");
    const floorItems = menu ? menu.querySelectorAll(".floor-item") : [];

    if (!btn || !menu) {
        console.error("Floor dropdown elements not found!");
        return;
    }

    btn.addEventListener("click", (e) => {
        e.stopPropagation(); // prevents instant close bug

        const isOpen = menu.classList.toggle("show");
        btn.setAttribute("aria-expanded", String(isOpen));
    });
    floorItems.forEach((item) => {
        item.addEventListener("click", () => {
            menu.classList.remove("show");
            btn.setAttribute("aria-expanded", "false");
        });
    });

    document.addEventListener("click", (e) => {
        if (!menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.remove("show");
            btn.setAttribute("aria-expanded", "false");
        }
    });
});