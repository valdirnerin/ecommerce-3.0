const mapElement = document.getElementById("partnersMap");
const listElement = document.getElementById("partnersList");
const searchInput = document.getElementById("partnerSearch");
const tagSelect = document.getElementById("partnerTag");

let partners = [];
let markers = [];
let mapInstance = null;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createMap() {
  if (!mapElement || typeof L === "undefined") return null;
  const map = L.map(mapElement).setView([-34.6, -58.4], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);
  return map;
}

function clearMarkers() {
  markers.forEach((marker) => marker.remove());
  markers = [];
}

function updateMarkers(items) {
  if (!mapInstance) return;
  clearMarkers();
  items.forEach((partner) => {
    if (partner.lat == null || partner.lng == null) return;
    const marker = L.marker([Number(partner.lat), Number(partner.lng)]).addTo(mapInstance);
    const safeName = escapeHtml(partner.name || "Partner");
    const safeAddress = escapeHtml(partner.address || "");
    marker.bindPopup(`<strong>${safeName}</strong><br>${safeAddress}`);
    markers.push(marker);
  });
  if (items.length) {
    const group = L.featureGroup(markers);
    mapInstance.fitBounds(group.getBounds().pad(0.2));
  }
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function getFilteredPartners() {
  const query = normalizeText(searchInput?.value);
  const tag = normalizeText(tagSelect?.value);
  return partners.filter((partner) => {
    if (tag) {
      const tags = Array.isArray(partner.tags) ? partner.tags : [];
      const tagMatch = tags.some((item) => normalizeText(item) === tag);
      if (!tagMatch) return false;
    }
    if (query) {
      const haystack = [partner.name, partner.address, ...(partner.tags || [])]
        .map(normalizeText)
        .join(" ");
      return haystack.includes(query);
    }
    return true;
  });
}

function renderReviews(container, reviews = []) {
  container.innerHTML = "";
  if (!reviews.length) {
    const empty = document.createElement("p");
    empty.textContent = "Sin reseñas verificadas aún.";
    container.appendChild(empty);
    return;
  }
  reviews.slice(0, 3).forEach((review) => {
    const item = document.createElement("div");
    item.className = "partner-review";
    const rating = document.createElement("strong");
    rating.textContent = `★ ${review.rating}/5`;
    const text = document.createElement("p");
    text.textContent = review.text || "";
    item.append(rating, text);
    container.appendChild(item);
  });
}

async function loadPartnerReviews(partnerId, container) {
  try {
    const res = await fetch(`/api/partners/${encodeURIComponent(partnerId)}`);
    if (!res.ok) throw new Error("partner-detail");
    const data = await res.json();
    renderReviews(container, Array.isArray(data.reviews) ? data.reviews : []);
  } catch (err) {
    container.textContent = "No pudimos cargar las reseñas.";
  }
}

function renderList(items) {
  if (!listElement) return;
  listElement.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = "No se encontraron partners con esos filtros.";
    listElement.appendChild(empty);
    return;
  }
  items.forEach((partner) => {
    const card = document.createElement("article");
    card.className = "partner-card";

    const title = document.createElement("h3");
    title.textContent = partner.name || "Partner";

    const address = document.createElement("p");
    address.textContent = partner.address || "";

    const tagsWrap = document.createElement("div");
    tagsWrap.className = "partner-tags";
    (partner.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "partner-tag";
      chip.textContent = tag;
      tagsWrap.appendChild(chip);
    });

    const actions = document.createElement("div");
    actions.className = "partner-actions";
    if (partner.whatsapp) {
      const wa = document.createElement("a");
      const normalized = partner.whatsapp.replace(/\D/g, "");
      wa.href = `https://wa.me/${normalized}`;
      wa.target = "_blank";
      wa.rel = "noopener";
      wa.textContent = "Contactar por WhatsApp";
      actions.appendChild(wa);
    }

    const reviewToggle = document.createElement("button");
    reviewToggle.className = "button";
    reviewToggle.type = "button";
    reviewToggle.textContent = "Ver reseñas";

    const reviewsContainer = document.createElement("div");
    reviewsContainer.style.display = "none";

    reviewToggle.addEventListener("click", () => {
      const isOpen = reviewsContainer.style.display === "block";
      reviewsContainer.style.display = isOpen ? "none" : "block";
      reviewToggle.textContent = isOpen ? "Ver reseñas" : "Ocultar reseñas";
      if (!isOpen && !reviewsContainer.dataset.loaded) {
        reviewsContainer.dataset.loaded = "true";
        loadPartnerReviews(partner.id, reviewsContainer);
      }
    });

    card.append(title, address, tagsWrap, actions, reviewToggle, reviewsContainer);
    listElement.appendChild(card);
  });
}

function refreshView() {
  const filtered = getFilteredPartners();
  renderList(filtered);
  updateMarkers(filtered);
}

function populateTags(items) {
  if (!tagSelect) return;
  const tags = new Set();
  items.forEach((partner) => {
    (partner.tags || []).forEach((tag) => tags.add(tag));
  });
  tagSelect.innerHTML = '<option value="">Todos</option>';
  Array.from(tags)
    .sort()
    .forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = tag;
      tagSelect.appendChild(option);
    });
}

async function loadPartners() {
  try {
    const res = await fetch("/api/partners?status=APPROVED");
    if (!res.ok) throw new Error("partners-load");
    const data = await res.json();
    partners = Array.isArray(data.partners) ? data.partners : [];
    populateTags(partners);
    refreshView();
  } catch (err) {
    if (listElement) {
      listElement.textContent = "No pudimos cargar los partners verificados.";
    }
  }
}

mapInstance = createMap();
if (searchInput) searchInput.addEventListener("input", refreshView);
if (tagSelect) tagSelect.addEventListener("change", refreshView);

loadPartners();
