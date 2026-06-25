// ─── CONFIG ──────────────────────────────────────────────────────────────
const API = '';
const CSRF = () => document.cookie.split('; ').find(r => r.startsWith('csrftoken='))?.split('=')[1] || '';

// ─── STATE ───────────────────────────────────────────────────────────────
let allLocations = [];
let allConnections = [];
let allAnnouncements = [];
let allHazards = [];

// ─── API ─────────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
    const res = await fetch(API + url, {
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRF(), ...opts.headers },
        credentials: 'same-origin',
        ...opts,
    });
    if (!res.ok) throw new Error(await res.text());
    if (res.status === 204) return null;
    return res.json();
}

// ─── INIT ────────────────────────────────────────────────────────────────
async function loadAll() {
    await Promise.all([loadLocations(), loadConnections(), loadAnnouncements(), loadHazards()]);
    updateStats();
    renderDashboard();
}

// ─── LOCATIONS ───────────────────────────────────────────────────────────
async function loadLocations() {
    try {
        allLocations = await apiFetch('/api/locations/');
        renderLocations();
        populateLocationSelects();
        document.getElementById('loc-count').textContent = allLocations.length;
    } catch (e) { showToast('Failed to load locations', 'error'); }
}

function renderLocations() {
    const tbody = document.getElementById('loc-table');
    if (!allLocations.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-map-pin"></i><p>No locations found</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = allLocations.map(loc => `
        <tr data-search="${loc.room_name.toLowerCase()} floor${loc.floor_location}">
            <td class="mono">#${loc.id}</td>
            <td><strong>${loc.room_name}</strong></td>
            <td><span class="badge badge-floor">Floor ${loc.floor_location}</span></td>
            <td class="mono">${loc.x_coordinate?.toFixed(2) ?? '—'}</td>
            <td class="mono">${loc.y_coordinate?.toFixed(2) ?? '—'}</td>
            <td>${loc.stair_type ? `<span class="badge badge-${loc.stair_type}">${loc.stair_type}</span>` : `<span class="badge badge-none">—</span>`}</td>
            <td><div class="actions-cell">
                <button class="btn btn-ghost btn-sm" onclick="editLocation(${loc.id})"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-danger btn-sm" onclick="confirmDelete('location', ${loc.id}, '${loc.room_name}')"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`).join('');
}

function clearLocForm() {
    ['loc-id', 'loc-room_name', 'loc-floor_location', 'loc-x_coordinate', 'loc-y_coordinate'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('loc-stair_type').value = '';
    document.getElementById('loc-modal-title').textContent = 'Add Location';
}

function editLocation(id) {
    const loc = allLocations.find(l => l.id === id);
    if (!loc) return;
    document.getElementById('loc-modal-title').textContent = 'Edit Location';
    document.getElementById('loc-id').value = loc.id;
    document.getElementById('loc-room_name').value = loc.room_name;
    document.getElementById('loc-floor_location').value = loc.floor_location;
    document.getElementById('loc-x_coordinate').value = loc.x_coordinate;
    document.getElementById('loc-y_coordinate').value = loc.y_coordinate;
    document.getElementById('loc-stair_type').value = loc.stair_type || '';
    openModal('location');
}

async function saveLocation() {
    const id = document.getElementById('loc-id').value;
    const payload = {
        room_name: document.getElementById('loc-room_name').value,
        floor_location: parseInt(document.getElementById('loc-floor_location').value),
        x_coordinate: parseFloat(document.getElementById('loc-x_coordinate').value),
        y_coordinate: parseFloat(document.getElementById('loc-y_coordinate').value),
        stair_type: document.getElementById('loc-stair_type').value || null,
    };
    try {
        if (id) { await apiFetch(`/api/locations/${id}/`, { method: 'PUT', body: JSON.stringify(payload) }); showToast('Location updated'); }
        else { await apiFetch('/api/locations/', { method: 'POST', body: JSON.stringify(payload) }); showToast('Location added'); }
        closeModal('location');
        loadLocations();
    } catch (e) { showToast('Save failed', 'error'); }
}

// ─── CONNECTIONS ─────────────────────────────────────────────────────────
async function loadConnections() {
    try {
        allConnections = await apiFetch('/api/connections/');
        renderConnections();
        document.getElementById('conn-count').textContent = allConnections.length;
    } catch (e) { showToast('Failed to load connections', 'error'); }
}

function renderConnections() {
    const tbody = document.getElementById('conn-table');
    if (!allConnections.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-route"></i><p>No connections found</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = allConnections.map(c => `
        <tr data-search="${(c.from_location_name || '').toLowerCase()} ${(c.to_location_name || '').toLowerCase()}">
            <td class="mono">#${c.id}</td>
            <td><strong>${c.from_location_name || c.from_location}</strong></td>
            <td><strong>${c.to_location_name || c.to_location}</strong></td>
            <td class="mono">${c.cost}</td>
            <td><div class="actions-cell">
                <button class="btn btn-ghost btn-sm" onclick="editConnection(${c.id})"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-danger btn-sm" onclick="confirmDelete('connection', ${c.id}, 'this connection')"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`).join('');
}

function clearConnForm() {
    ['conn-id', 'conn-cost'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('conn-modal-title').textContent = 'Add Connection';
}

function editConnection(id) {
    const c = allConnections.find(x => x.id === id);
    if (!c) return;
    document.getElementById('conn-modal-title').textContent = 'Edit Connection';
    document.getElementById('conn-id').value = c.id;
    document.getElementById('conn-from_location').value = c.from_location;
    document.getElementById('conn-to_location').value = c.to_location;
    document.getElementById('conn-cost').value = c.cost;
    openModal('connection');
}

async function saveConnection() {
    const id = document.getElementById('conn-id').value;
    const payload = {
        from_location: parseInt(document.getElementById('conn-from_location').value),
        to_location: parseInt(document.getElementById('conn-to_location').value),
        cost: parseFloat(document.getElementById('conn-cost').value),
    };
    try {
        if (id) { await apiFetch(`/api/connections/${id}/`, { method: 'PUT', body: JSON.stringify(payload) }); showToast('Connection updated'); }
        else { await apiFetch('/api/connections/', { method: 'POST', body: JSON.stringify(payload) }); showToast('Connection added'); }
        closeModal('connection');
        loadConnections();
    } catch (e) { showToast('Save failed', 'error'); }
}

// ─── ANNOUNCEMENTS ───────────────────────────────────────────────────────
async function loadAnnouncements() {
    try {
        allAnnouncements = await apiFetch('/api/announcements/');
        renderAnnouncements();
        document.getElementById('ann-count').textContent = allAnnouncements.length;
    } catch (e) { showToast('Failed to load announcements', 'error'); }
}

function renderAnnouncements() {
    const tbody = document.getElementById('ann-table');
    if (!allAnnouncements.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-bullhorn"></i><p>No announcements found</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = allAnnouncements.map(a => `
        <tr data-search="${a.title.toLowerCase()} ${(a.description || '').toLowerCase()}">
            <td class="mono">#${a.id}</td>
            <td><strong>${a.title}</strong></td>
            <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${a.description || '—'}</td>
            <td>${a.from_location_name || '<span style="color:var(--muted)">—</span>'}</td>
            <td><strong>${a.to_location_name || a.to_location}</strong></td>
            <td class="mono" style="font-size:0.75rem;">${a.date_pub ? new Date(a.date_pub).toLocaleDateString() : '—'}</td>
            <td><div class="actions-cell">
                <button class="btn btn-ghost btn-sm" onclick="editAnnouncement(${a.id})"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-danger btn-sm" onclick="confirmDelete('announcement', ${a.id}, '${a.title}')"><i class="fa-solid fa-trash"></i></button>
            </div></td>
        </tr>`).join('');
}

function clearAnnForm() {
    ['ann-id', 'ann-title', 'ann-description'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('ann-from_location').value = '';
    document.getElementById('ann-modal-title').textContent = 'Add Announcement';
}

function editAnnouncement(id) {
    const a = allAnnouncements.find(x => x.id === id);
    if (!a) return;
    document.getElementById('ann-modal-title').textContent = 'Edit Announcement';
    document.getElementById('ann-id').value = a.id;
    document.getElementById('ann-title').value = a.title;
    document.getElementById('ann-description').value = a.description || '';
    document.getElementById('ann-from_location').value = a.from_location || '';
    document.getElementById('ann-to_location').value = a.to_location;
    openModal('announcement');
}

async function saveAnnouncement() {
    const id = document.getElementById('ann-id').value;
    const fromVal = document.getElementById('ann-from_location').value;
    const payload = {
        title: document.getElementById('ann-title').value,
        description: document.getElementById('ann-description').value,
        from_location: fromVal ? parseInt(fromVal) : null,
        to_location: parseInt(document.getElementById('ann-to_location').value),
    };
    try {
        if (id) { await apiFetch(`/api/announcements/${id}/`, { method: 'PUT', body: JSON.stringify(payload) }); showToast('Announcement updated'); }
        else { await apiFetch('/api/announcements/', { method: 'POST', body: JSON.stringify(payload) }); showToast('Announcement added'); }
        closeModal('announcement');
        loadAnnouncements();
    } catch (e) { showToast('Save failed', 'error'); }
}

// ─── HAZARDS ───────────────────────────────────────────────────────────
async function loadHazards() {
    try {
        allHazards = await apiFetch('/api/hazards/');
        renderHazards();
        document.getElementById('hazard-count').textContent = allHazards.length;
    } catch (e) {
        showToast('Failed to load hazards', 'error');
    }
}

function renderHazards() {
    const tbody = document.getElementById('hazard-table');

    if (!allHazards.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i class="fa-solid fa-flag"></i>
                        <p>No hazard reports found</p>
                    </div>
                </td>
            </tr>`;
        return;
    }

    tbody.innerHTML = allHazards.map(h => `
    <tr data-search="${(h.title || '').toLowerCase()} ${(h.description || '').toLowerCase()}">

        <td class="mono">#${h.id}</td>

        <td><strong>${h.title || '—'}</strong></td>

        <td>
            ${h.image
            ? `<a href="${h.image}" target="_blank">View Image</a>`
            : '—'
        }
        </td>

        <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${h.description || '—'}
        </td>

        <td>
            <span class="badge badge-default">
                Active
            </span>
        </td>

        <td class="mono" style="font-size:0.75rem;">
            ${h.uploade_date
            ? new Date(h.uploade_date).toLocaleDateString()
            : '—'
        }
        </td>

        <td>
            <div class="actions-cell">
                <button class="btn btn-ghost btn-sm" onclick="editHazard(${h.id})">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn btn-danger btn-sm" onclick="confirmDelete('hazard', ${h.id}, 'this hazard')">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        </td>

    </tr>
`).join('');
}

// ─── DELETE ───────────────────────────────────────────────────────────────
function confirmDelete(type, id, name) {
    document.getElementById('confirm-msg').textContent = `Delete "${name}"? This cannot be undone.`;
    document.getElementById('confirm-ok-btn').onclick = () => deleteRecord(type, id);
    openModal('confirm');
}

async function deleteRecord(type, id) {
    const endpoints = { location: 'locations', connection: 'connections', announcement: 'announcements' };
    try {
        await apiFetch(`/api/${endpoints[type]}/${id}/`, { method: 'DELETE' });
        showToast(`${type} deleted`);
        closeModal('confirm');
        loadAll();
    } catch (e) { showToast('Delete failed', 'error'); }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────
function openModal(type) {
    if (type === 'connection' || type === 'announcement') populateLocationSelects();
    document.getElementById(`modal-${type}`).classList.add('show');
}

function closeModal(type) {
    document.getElementById(`modal-${type}`).classList.remove('show');
    if (type === 'location') clearLocForm();
    if (type === 'connection') clearConnForm();
    if (type === 'announcement') clearAnnForm();
}

function populateLocationSelects() {
    ['conn-from_location', 'conn-to_location', 'ann-from_location', 'ann-to_location'].forEach(id => {
        const el = document.getElementById(id);
        const isOptional = id === 'ann-from_location';
        el.innerHTML = isOptional ? '<option value="">— None —</option>' : '';
        allLocations.forEach(loc => { el.innerHTML += `<option value="${loc.id}">${loc.room_name} (F${loc.floor_location})</option>`; });
    });
}

function updateStats() {
    document.getElementById('stat-loc').textContent = allLocations.length;
    document.getElementById('stat-conn').textContent = allConnections.length;
    document.getElementById('stat-ann').textContent = allAnnouncements.length;
}

function renderDashboard() {
    const tbody = document.getElementById('dash-ann-table');
    const recent = [...allAnnouncements].slice(0, 5);
    if (!recent.length) {
        tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-bullhorn"></i><p>No announcements yet</p></div></td></tr>`;
        return;
    }
    tbody.innerHTML = recent.map(a => `
        <tr>
            <td><strong>${a.title}</strong></td>
            <td>${a.from_location_name || '—'}</td>
            <td>${a.to_location_name || a.to_location}</td>
            <td class="mono" style="font-size:0.75rem;">${a.date_pub ? new Date(a.date_pub).toLocaleDateString() : '—'}</td>
        </tr>`).join('');
}

function filterTable(tableId, query) {
    document.querySelectorAll(`#${tableId} tr[data-search]`).forEach(row => {
        row.style.display = row.dataset.search.includes(query.toLowerCase()) ? '' : 'none';
    });
}

function switchSection(name, btn) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById(`section-${name}`).classList.add('active');
    btn.classList.add('active');
    document.getElementById('topbar-title').textContent = btn.textContent.trim();
    if (window.innerWidth <= 768) toggleSidebar();
}

let toastTimer;
function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = toast.querySelector('i');
    document.getElementById('toast-msg').textContent = msg;
    toast.className = `toast ${type}`;
    icon.className = type === 'success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function toggleSidebar() {
    document.querySelector('.sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('show');
}

// ─── DOM READY ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Hamburger
    document.getElementById('menu-toggle').addEventListener('click', toggleSidebar);

    // Overlay click closes sidebar
    document.getElementById('sidebar-overlay').addEventListener('click', toggleSidebar);

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.classList.remove('show');
        });
    });

    loadAll();
});