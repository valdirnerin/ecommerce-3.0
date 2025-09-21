import { fetchProducts, isWholesale } from "./api.js";

const detailSection = document.getElementById("productDetail");
const galleryContainer = document.getElementById("gallery");
const infoContainer = document.getElementById("productInfo");
const lightboxElement = document.getElementById("lightbox");
const priceFormatter = new Intl.NumberFormat("es-AR");
const FALLBACK_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function findExistingPreload(url) {
  const links = document.head?.querySelectorAll(
    'link[rel="preload"][as="image"]',
  );
  if (!links) return null;
  return Array.from(links).find((link) => link.href === url);
}

function ensurePreload(url) {
  if (!url) return;
  const head = document.head;
  if (!head) return;
  const existing = findExistingPreload(new URL(url, window.location.href).href);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.href = url;
  head.appendChild(link);
}

function updateJsonLd(product, images) {
  if (!product || !images.length) return;
  const head = document.head;
  if (!head) return;
  const existing = head.querySelector("#product-jsonld");
  if (existing) existing.remove();
  const availability =
    typeof product.stock === "number" && product.stock > 0
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock";
  const offers = {
    "@type": "Offer",
    price: Number(
      isWholesale() ? product.price_mayorista : product.price_minorista,
    ).toFixed(2),
    priceCurrency: "ARS",
    availability,
  };
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    image: images,
    description: product.meta_description || product.description || "",
    sku: product.sku || "",
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    offers,
  };
  if (!schema.brand) delete schema.brand;
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.id = "product-jsonld";
  script.textContent = JSON.stringify(schema, null, 2);
  head.appendChild(script);
}

function openLightbox(urls, startIndex = 0, alts = []) {
  if (!lightboxElement || !urls.length) return;
  let idx = startIndex;
  const previousActive = document.activeElement;
  const previousOverflow = document.body.style.overflow;
  lightboxElement.innerHTML = "";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "lightbox-close";
  closeBtn.textContent = "Cerrar";
  lightboxElement.appendChild(closeBtn);

  const nav = document.createElement("div");
  nav.className = "lightbox-nav";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "lightbox-arrow";
  prevBtn.setAttribute("aria-label", "Imagen anterior");
  prevBtn.innerHTML = "&#10094;";
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "lightbox-arrow";
  nextBtn.setAttribute("aria-label", "Imagen siguiente");
  nextBtn.innerHTML = "&#10095;";
  nav.append(prevBtn, nextBtn);
  lightboxElement.appendChild(nav);

  const pic = new Image();
  pic.className = "lightbox-img";
  pic.decoding = "async";
  pic.loading = "eager";
  lightboxElement.appendChild(pic);

  let startX = null;
  function show(delta) {
    idx = (idx + delta + urls.length) % urls.length;
    pic.src = urls[idx];
    pic.alt = alts[idx] || "";
  }

  const onKeyDown = (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    } else if (ev.key === "ArrowRight") {
      ev.preventDefault();
      show(1);
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      show(-1);
    }
  };

  const onPointerDown = (ev) => {
    if (ev.pointerType === "touch" || ev.pointerType === "pen") {
      startX = ev.clientX;
    }
  };

  const onPointerUp = (ev) => {
    if (startX == null) return;
    const delta = ev.clientX - startX;
    if (Math.abs(delta) > 40) {
      show(delta < 0 ? 1 : -1);
    }
    startX = null;
  };

  const onPointerCancel = () => {
    startX = null;
  };

  function close() {
    lightboxElement.setAttribute("aria-hidden", "true");
    lightboxElement.innerHTML = "";
    lightboxElement.removeEventListener("keydown", onKeyDown);
    lightboxElement.removeEventListener("click", onOverlayClick);
    pic.removeEventListener("pointerdown", onPointerDown);
    pic.removeEventListener("pointerup", onPointerUp);
    pic.removeEventListener("pointercancel", onPointerCancel);
    document.body.style.overflow = previousOverflow;
    if (previousActive && typeof previousActive.focus === "function") {
      previousActive.focus({ preventScroll: true });
    }
  }

  function onOverlayClick(ev) {
    if (ev.target === lightboxElement) {
      close();
    }
  }

  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", () => show(-1));
  nextBtn.addEventListener("click", () => show(1));
  lightboxElement.addEventListener("keydown", onKeyDown);
  lightboxElement.addEventListener("click", onOverlayClick);
  pic.addEventListener("pointerdown", onPointerDown);
  pic.addEventListener("pointerup", onPointerUp);
  pic.addEventListener("pointercancel", onPointerCancel);

  lightboxElement.setAttribute("aria-hidden", "false");
  lightboxElement.tabIndex = -1;
  document.body.style.overflow = "hidden";
  show(0);
  requestAnimationFrame(() => lightboxElement.focus({ preventScroll: true }));
}

function buildGallery(root, urls, alts = []) {
  if (!root) return;
  root.innerHTML = "";
  if (!urls.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "gallery-main";
    placeholder.textContent = "Sin imágenes disponibles";
    placeholder.style.display = "grid";
    placeholder.style.placeItems = "center";
    placeholder.style.color = "#666";
    root.appendChild(placeholder);
    return;
  }

  const normalizedAlts = urls.map((url, index) => alts[index] || "");
  const main = document.createElement("div");
  main.className = "gallery-main";
  const mainImg = new Image();
  mainImg.decoding = "async";
  mainImg.fetchPriority = "high";
  mainImg.src = urls[0];
  mainImg.alt = normalizedAlts[0];
  mainImg.draggable = false;
  main.appendChild(mainImg);

  const lens = document.createElement("div");
  lens.className = "zoom-lens";
  lens.style.backgroundImage = `url("${urls[0]}")`;
  main.appendChild(lens);

  main.setAttribute("role", "button");
  main.tabIndex = 0;
  main.setAttribute("aria-label", "Ampliar imagen del producto");

  const thumbs = document.createElement("div");
  thumbs.className = "thumbs";
  let currentIndex = 0;

  const thumbElements = urls.map((url, index) => {
    const thumb = document.createElement("img");
    thumb.src = url;
    thumb.alt = normalizedAlts[index];
    thumb.loading = index === 0 ? "eager" : "lazy";
    thumb.decoding = "async";
    thumb.setAttribute("role", "button");
    thumb.tabIndex = 0;
    thumb.setAttribute(
      "aria-label",
      `Mostrar imagen ${index + 1} de ${urls.length}`,
    );
    if (index === 0) thumb.setAttribute("aria-current", "true");
    thumb.addEventListener("click", () => updateMain(index));
    thumb.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        updateMain(index);
      }
    });
    thumbs.appendChild(thumb);
    return thumb;
  });

  function updateMain(index) {
    if (index === currentIndex) {
      openLightbox(urls, index, normalizedAlts);
      return;
    }
    currentIndex = index;
    mainImg.src = urls[index];
    mainImg.alt = normalizedAlts[index];
    lens.style.backgroundImage = `url("${urls[index]}")`;
    thumbElements.forEach((el, i) => {
      if (i === index) el.setAttribute("aria-current", "true");
      else el.removeAttribute("aria-current");
    });
  }

  main.addEventListener("mousemove", (ev) => {
    const rect = main.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 100;
    const y = ((ev.clientY - rect.top) / rect.height) * 100;
    lens.style.backgroundPosition = `${x}% ${y}%`;
  });

  main.addEventListener("click", () =>
    openLightbox(urls, currentIndex, normalizedAlts),
  );
  main.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      openLightbox(urls, currentIndex, normalizedAlts);
    }
  });

  root.append(main, thumbs);
}

function buildAttributes(product) {
  const attrs = [
    { label: "SKU", value: product.sku },
    { label: "Marca", value: product.brand },
    { label: "Modelo", value: product.model },
    { label: "Categoría", value: product.category },
    {
      label: "Peso",
      value: product.weight != null ? `${product.weight}\u00a0g` : null,
    },
    { label: "Dimensiones", value: product.dimensions },
    { label: "Color", value: product.color },
  ];
  const list = document.createElement("ul");
  list.className = "product-detail-attrs";
  attrs.forEach((attr) => {
    if (!attr.value) return;
    const li = document.createElement("li");
    li.textContent = `${attr.label}: ${attr.value}`;
    list.appendChild(li);
  });
  return list;
}

function formatPrice(value) {
  return `$${priceFormatter.format(Number(value || 0))}`;
}

function renderProduct(product) {
  if (!infoContainer || !galleryContainer) return;
  const arrayImages = Array.isArray(product.images)
    ? product.images.filter(Boolean)
    : [];
  const legacy = product.image ? [product.image] : [];
  const images = arrayImages.length ? arrayImages : legacy;
  const altInput = Array.isArray(product.images_alt) ? product.images_alt : [];
  const alts = images.map((_, i) => altInput[i] || product.name || "");
  const primaryImage = images[0] || "";
  const cartImage = primaryImage || FALLBACK_IMAGE;
  if (primaryImage) {
    ensurePreload(primaryImage);
  }
  product.image = primaryImage || cartImage;
  buildGallery(galleryContainer, images, alts);
  updateJsonLd(product, images);

  infoContainer.innerHTML = "";

  const title = document.createElement("h1");
  title.textContent = product.name;
  infoContainer.appendChild(title);

  if (product.description) {
    const desc = document.createElement("p");
    desc.className = "product-detail-desc";
    desc.textContent = product.description;
    infoContainer.appendChild(desc);
  }

  const attrs = buildAttributes(product);
  if (attrs.children.length) {
    infoContainer.appendChild(attrs);
  }

  const stockInfo = document.createElement("p");
  stockInfo.className = "product-stock-info";
  if (typeof product.stock === "number") {
    if (product.stock <= 0) {
      stockInfo.textContent = "Sin stock disponible";
      stockInfo.style.color = "var(--color-danger, #d9534f)";
    } else if (
      product.min_stock != null &&
      product.stock < product.min_stock
    ) {
      stockInfo.textContent = `Poco stock (quedan ${product.stock} unidades)`;
      stockInfo.style.color = "var(--color-warning, #f0ad4e)";
    } else {
      stockInfo.textContent = `Stock disponible: ${product.stock} unidades`;
    }
    infoContainer.appendChild(stockInfo);
  }

  const priceBlock = document.createElement("div");
  priceBlock.className = "product-detail-price";
  const minor = document.createElement("p");
  minor.textContent = `Precio minorista: ${formatPrice(
    product.price_minorista,
  )}`;
  priceBlock.appendChild(minor);
  if (isWholesale()) {
    const major = document.createElement("p");
    major.textContent = `Precio mayorista: ${formatPrice(
      product.price_mayorista,
    )}`;
    priceBlock.appendChild(major);
  }
  infoContainer.appendChild(priceBlock);

  if (typeof product.stock === "number" && product.stock > 0) {
    const buyDiv = document.createElement("div");
    buyDiv.className = "product-detail-buy";
    const primaryPrice = isWholesale()
      ? product.price_mayorista
      : product.price_minorista;

    if (isWholesale()) {
      const qtyInput = document.createElement("input");
      qtyInput.type = "number";
      qtyInput.min = 1;
      qtyInput.value = 1;
      qtyInput.max = product.stock;
      const priceLabel = document.createElement("span");
      priceLabel.className = "product-detail-unit-price";
      const updatePrice = () => {
        let qty = parseInt(qtyInput.value, 10) || 1;
        if (qty > product.stock) qty = product.stock;
        if (qty < 1) qty = 1;
        qtyInput.value = qty;
        let discount = 0;
        if (qty >= 20) discount = 0.15;
        else if (qty >= 10) discount = 0.1;
        else if (qty >= 5) discount = 0.05;
        const unit = Math.round(product.price_mayorista * (1 - discount));
        priceLabel.textContent = `Precio c/u: ${formatPrice(unit)} (x${qty})`;
      };
      qtyInput.addEventListener("input", updatePrice);
      updatePrice();
      const addBtn = document.createElement("button");
      addBtn.className = "button primary";
      addBtn.textContent = "Agregar al carrito";
      addBtn.addEventListener("click", () => {
        const qty = parseInt(qtyInput.value, 10) || 1;
        if (qty > product.stock) {
          alert(`No hay stock suficiente. Disponibles: ${product.stock}`);
          qtyInput.value = product.stock;
          return;
        }
        const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
        const existing = cart.find((item) => item.id === product.id);
        if (existing) {
          if (existing.quantity + qty > product.stock) {
            alert(
              `Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${product.stock}`,
            );
            return;
          }
          existing.quantity += qty;
        } else {
          cart.push({
            id: product.id,
            name: product.name,
            price: product.price_mayorista,
            quantity: qty,
            image: cartImage,
          });
        }
        localStorage.setItem("nerinCart", JSON.stringify(cart));
        if (window.updateNav) window.updateNav();
        if (window.showToast)
          window.showToast("✅ Producto agregado al carrito");
        addBtn.textContent = "Añadido";
        setTimeout(() => {
          addBtn.textContent = "Agregar al carrito";
        }, 2000);
      });
      buyDiv.append(qtyInput, addBtn, priceLabel);
    } else {
      const addBtn = document.createElement("button");
      addBtn.className = "button primary";
      addBtn.textContent = "Agregar al carrito";
      addBtn.addEventListener("click", () => {
        const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
        const existing = cart.find((item) => item.id === product.id);
        const available = product.stock;
        if (existing) {
          if (existing.quantity + 1 > available) {
            alert(
              `Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${available}`,
            );
            return;
          }
          existing.quantity += 1;
        } else {
          cart.push({
            id: product.id,
            name: product.name,
            price: primaryPrice,
            quantity: 1,
            image: cartImage,
          });
        }
        localStorage.setItem("nerinCart", JSON.stringify(cart));
        if (window.updateNav) window.updateNav();
        if (window.showToast)
          window.showToast("✅ Producto agregado al carrito");
        addBtn.textContent = "Añadido";
        setTimeout(() => {
          addBtn.textContent = "Agregar al carrito";
        }, 2000);
      });
      buyDiv.appendChild(addBtn);
    }

    const ctaSticky = document.createElement("div");
    ctaSticky.className = "cta-sticky";
    ctaSticky.appendChild(buyDiv);
    infoContainer.appendChild(ctaSticky);
  }
}

async function initProduct() {
  if (!detailSection) return;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  if (!id) {
    if (infoContainer) infoContainer.innerHTML = "<p>Producto no especificado.</p>";
    return;
  }
  try {
    const products = await fetchProducts();
    const product = products.find((p) => String(p.id) === String(id));
    if (!product) {
      if (infoContainer)
        infoContainer.innerHTML = "<p>Producto no encontrado.</p>";
      if (galleryContainer) galleryContainer.innerHTML = "";
      return;
    }
    renderProduct(product);
    document.title = `${product.name} – NERIN`;
  } catch (err) {
    if (infoContainer)
      infoContainer.innerHTML = `<p>Error al cargar producto: ${err.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", initProduct);
