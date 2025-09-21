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

function updateHeadImages(images, alts = []) {
  const head = document.head;
  if (!head) return;
  head
    .querySelectorAll("meta[data-product-image-meta]")
    .forEach((node) => node.remove());
  if (!images.length) return;

  const appendMeta = (attr, value, content) => {
    const meta = document.createElement("meta");
    meta.setAttribute(attr, value);
    meta.content = content;
    meta.dataset.productImageMeta = "true";
    head.appendChild(meta);
    return meta;
  };

  images.forEach((url, index) => {
    appendMeta("property", "og:image", url);
    const alt = alts[index];
    if (alt) {
      appendMeta("property", "og:image:alt", alt);
    }
  });

  appendMeta("name", "twitter:card", "summary_large_image");
  appendMeta("name", "twitter:image", images[0]);
  appendMeta("name", "twitter:image:alt", alts[0] || "");
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
    placeholder.className = "product-gallery__empty";
    placeholder.textContent = "Sin imágenes disponibles";
    root.appendChild(placeholder);
    return;
  }

  const normalizedAlts = urls.map((url, index) => alts[index] || "");
  const total = urls.length;
  let currentIndex = 0;

  const gallery = document.createElement("div");
  gallery.className = "product-gallery";
  if (total > 1) gallery.classList.add("product-gallery--multiple");
  gallery.tabIndex = 0;
  gallery.setAttribute("role", "region");
  gallery.setAttribute("aria-label", "Galería de imágenes del producto");

  const viewport = document.createElement("div");
  viewport.className = "product-gallery__viewport";
  viewport.setAttribute("aria-live", "polite");
  viewport.setAttribute("aria-roledescription", "Carrusel");

  const track = document.createElement("div");
  track.className = "product-gallery__track";
  viewport.appendChild(track);

  const slides = urls.map((url, index) => {
    const slide = document.createElement("figure");
    slide.className = "product-gallery__slide";
    slide.setAttribute("aria-hidden", index === 0 ? "false" : "true");
    slide.dataset.index = String(index);

    const picture = document.createElement("picture");
    const img = new Image();
    img.className = "product-gallery__image";
    img.decoding = "async";
    img.loading = index === 0 ? "eager" : "lazy";
    img.fetchPriority = index === 0 ? "high" : "auto";
    img.src = url;
    img.srcset = `${url} 1x, ${url} 2x`;
    img.sizes = "(min-width: 1280px) 40vw, (min-width: 768px) 60vw, 90vw";
    img.alt = normalizedAlts[index];
    img.draggable = false;
    picture.appendChild(img);
    slide.appendChild(picture);
    track.appendChild(slide);

    img.addEventListener("click", () =>
      openLightbox(urls, index, normalizedAlts),
    );

    return { slide, img };
  });

  let pointerStartX = null;
  let pointerId = null;
  let pointerMoved = false;

  const thumbButtons = [];

  const updateControls = () => {
    const navDisabled = total <= 1;
    if (prevBtn) {
      prevBtn.disabled = navDisabled;
      prevBtn.setAttribute("aria-hidden", navDisabled ? "true" : "false");
      prevBtn.tabIndex = navDisabled ? -1 : 0;
    }
    if (nextBtn) {
      nextBtn.disabled = navDisabled;
      nextBtn.setAttribute("aria-hidden", navDisabled ? "true" : "false");
      nextBtn.tabIndex = navDisabled ? -1 : 0;
    }
  };

  const goTo = (targetIndex, options = {}) => {
    if (!total) return;
    const nextIndex = (targetIndex + total) % total;
    currentIndex = nextIndex;
    track.style.transform = `translateX(-${nextIndex * 100}%)`;
    slides.forEach(({ slide }, i) => {
      slide.setAttribute("aria-hidden", i === nextIndex ? "false" : "true");
    });
    thumbButtons.forEach((btn, i) => {
      if (i === nextIndex) {
        btn.setAttribute("aria-selected", "true");
        if (options.focusThumb) {
          btn.focus({ preventScroll: true });
        }
      } else {
        btn.setAttribute("aria-selected", "false");
      }
    });
    updateControls();
  };

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "product-gallery__nav product-gallery__nav--prev";
  prevBtn.setAttribute("aria-label", "Ver imagen anterior");
  prevBtn.innerHTML = "<span aria-hidden=\"true\">&#10094;</span>";
  prevBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    goTo(currentIndex - 1);
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "product-gallery__nav product-gallery__nav--next";
  nextBtn.setAttribute("aria-label", "Ver imagen siguiente");
  nextBtn.innerHTML = "<span aria-hidden=\"true\">&#10095;</span>";
  nextBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    goTo(currentIndex + 1);
  });

  viewport.append(prevBtn, nextBtn);

  viewport.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "touch" || ev.pointerType === "pen") {
      pointerStartX = ev.clientX;
      pointerId = ev.pointerId;
      pointerMoved = false;
      viewport.setPointerCapture(pointerId);
    }
  });

  viewport.addEventListener("pointerup", (ev) => {
    if (pointerId == null || ev.pointerId !== pointerId) return;
    const delta = ev.clientX - pointerStartX;
    const shouldSlide = Math.abs(delta) > 40;
    if (shouldSlide) {
      goTo(currentIndex + (delta < 0 ? 1 : -1));
    }
    pointerMoved = shouldSlide;
    pointerStartX = null;
    pointerId = null;
    try {
      viewport.releasePointerCapture(ev.pointerId);
    } catch (err) {
      /* ignore */
    }
  });

  viewport.addEventListener("pointercancel", () => {
    pointerStartX = null;
    pointerId = null;
    pointerMoved = false;
  });

  gallery.addEventListener("keydown", (ev) => {
    const target = ev.target;
    if (ev.key === "ArrowRight") {
      ev.preventDefault();
      goTo(currentIndex + 1);
    } else if (ev.key === "ArrowLeft") {
      ev.preventDefault();
      goTo(currentIndex - 1);
    } else if (
      (ev.key === "Enter" || ev.key === " ") &&
      (target === gallery || target === viewport)
    ) {
      ev.preventDefault();
      openLightbox(urls, currentIndex, normalizedAlts);
    }
  });

  const thumbsContainer = document.createElement("div");
  thumbsContainer.className = "product-thumbs";
  thumbsContainer.setAttribute("role", "tablist");
  thumbsContainer.setAttribute(
    "aria-label",
    "Miniaturas del producto",
  );

  urls.forEach((url, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "product-thumbs__item";
    button.setAttribute(
      "aria-label",
      `Ver imagen ${index + 1} de ${total}`,
    );
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", index === 0 ? "true" : "false");
    button.dataset.index = String(index);

    const thumbImg = new Image();
    thumbImg.decoding = "async";
    thumbImg.loading = index === 0 ? "eager" : "lazy";
    thumbImg.src = url;
    thumbImg.srcset = `${url} 1x, ${url} 2x`;
    thumbImg.sizes = "72px";
    thumbImg.alt = normalizedAlts[index];
    thumbImg.draggable = false;

    button.appendChild(thumbImg);

    button.addEventListener("click", () => {
      goTo(index);
    });

    button.addEventListener("keydown", (ev) => {
      if (ev.key === "ArrowRight") {
        ev.preventDefault();
        ev.stopPropagation();
        goTo(index + 1, { focusThumb: true });
      } else if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        ev.stopPropagation();
        goTo(index - 1, { focusThumb: true });
      } else if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        ev.stopPropagation();
        openLightbox(urls, index, normalizedAlts);
      }
    });

    thumbButtons.push(button);
    thumbsContainer.appendChild(button);
  });

  viewport.addEventListener("click", () => {
    if (pointerMoved) {
      pointerMoved = false;
      return;
    }
    openLightbox(urls, currentIndex, normalizedAlts);
  });

  updateControls();
  gallery.appendChild(viewport);
  root.appendChild(gallery);
  if (total > 1) {
    root.appendChild(thumbsContainer);
  }
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
  const skuLabel = product.sku || product.id || product.name || "sin-identificar";
  const alts = images.map((_, i) => {
    const rawAlt = altInput[i];
    if (typeof rawAlt === "string" && rawAlt.trim()) return rawAlt.trim();
    return `Producto ${skuLabel} \u2013 imagen ${i + 1}`;
  });
  const primaryImage = images[0] || "";
  const cartImage = primaryImage || FALLBACK_IMAGE;
  if (primaryImage) {
    ensurePreload(primaryImage);
  }
  product.images = [...images];
  product.image = primaryImage || cartImage;
  buildGallery(galleryContainer, images, alts);
  updateHeadImages(images, alts);
  updateJsonLd(product, images);

  infoContainer.innerHTML = "";

  const summary = document.createElement("header");
  summary.className = "product-summary";

  const title = document.createElement("h1");
  title.textContent = product.name;
  summary.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "product-meta";

  if (product.brand) {
    const brand = document.createElement("span");
    brand.className = "product-meta__item";
    brand.innerHTML = `<strong>Marca:</strong> ${product.brand}`;
    meta.appendChild(brand);
  }

  if (product.sku) {
    const sku = document.createElement("span");
    sku.className = "product-meta__item";
    sku.innerHTML = `<strong>SKU:</strong> ${product.sku}`;
    meta.appendChild(sku);
  }

  if (product.category) {
    const category = document.createElement("span");
    category.className = "product-meta__item";
    category.innerHTML = `<strong>Categoría:</strong> ${product.category}`;
    meta.appendChild(category);
  }

  if (meta.children.length) {
    summary.appendChild(meta);
  }

  let stockCopy = "";
  let stockStatus = "default";
  if (typeof product.stock === "number") {
    if (product.stock <= 0) {
      stockCopy = "Sin stock disponible";
      stockStatus = "out";
    } else if (
      product.min_stock != null &&
      product.stock < product.min_stock
    ) {
      stockCopy = `Poco stock • ${product.stock} u.`;
      stockStatus = "low";
    } else {
      stockCopy = `Stock disponible • ${product.stock} u.`;
      stockStatus = "in";
    }
  }

  if (stockCopy) {
    const stockBadge = document.createElement("span");
    stockBadge.className = `product-stock-badge product-stock-badge--${stockStatus}`;
    stockBadge.textContent = stockCopy;
    summary.appendChild(stockBadge);
  }

  infoContainer.appendChild(summary);

  const panels = document.createElement("div");
  panels.className = "product-info-panels";

  const detailsPanel = document.createElement("section");
  detailsPanel.className = "product-details-panel";
  detailsPanel.setAttribute("aria-label", "Descripción del producto");

  const detailsHeading = document.createElement("h2");
  detailsHeading.textContent = "Descripción y detalles";
  detailsPanel.appendChild(detailsHeading);

  if (product.description) {
    const desc = document.createElement("p");
    desc.className = "product-detail-desc";
    desc.textContent = product.description;
    detailsPanel.appendChild(desc);
  }

  const attrs = buildAttributes(product);
  if (attrs.children.length) {
    const specsCard = document.createElement("div");
    specsCard.className = "product-specs-card";
    const specsHeading = document.createElement("h3");
    specsHeading.textContent = "Especificaciones técnicas";
    specsCard.append(specsHeading, attrs);
    detailsPanel.appendChild(specsCard);
  }

  const trustList = document.createElement("ul");
  trustList.className = "product-trust";
  [
    {
      title: "Asesoría especializada",
      description: "Equipo enfocado en repuestos originales y OEM.",
    },
    {
      title: "Logística a todo el país",
      description: "Despachamos en 24h y seguimiento en línea.",
    },
    {
      title: "Garantía oficial",
      description: "Todos los productos cuentan con cobertura real.",
    },
  ].forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${item.title}</strong><span>${item.description}</span>`;
    trustList.appendChild(li);
  });
  detailsPanel.appendChild(trustList);

  panels.appendChild(detailsPanel);

  const pricingPanel = document.createElement("aside");
  pricingPanel.className = "product-pricing-panel";
  pricingPanel.setAttribute("aria-label", "Acciones de compra");

  const pricingHeading = document.createElement("h2");
  pricingHeading.textContent = "Comprar este repuesto";
  pricingPanel.appendChild(pricingHeading);

  if (stockCopy) {
    const stockInfo = document.createElement("p");
    stockInfo.className = "product-stock-info";
    stockInfo.textContent = stockCopy;
    pricingPanel.appendChild(stockInfo);
  }

  const priceBlock = document.createElement("div");
  priceBlock.className = "product-detail-price";
  const minor = document.createElement("p");
  minor.innerHTML = `<span>Precio minorista</span><strong>${formatPrice(
    product.price_minorista,
  )}</strong>`;
  priceBlock.appendChild(minor);
  if (isWholesale()) {
    const major = document.createElement("p");
    major.innerHTML = `<span>Precio mayorista</span><strong>${formatPrice(
      product.price_mayorista,
    )}</strong>`;
    priceBlock.appendChild(major);
  }
  pricingPanel.appendChild(priceBlock);

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
    pricingPanel.appendChild(ctaSticky);
  }

  const perks = document.createElement("ul");
  perks.className = "product-perks";
  [
    {
      title: "Retiro en sucursal",
      detail: "Coordiná tu visita y retiralo sin costo en San Telmo.",
    },
    {
      title: "Pagá como quieras",
      detail: "Transferencia, tarjetas o Mercado Pago con cuotas.",
    },
    {
      title: "Soporte posventa",
      detail: "Acompañamiento técnico para la instalación.",
    },
  ].forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${item.title}</strong><span>${item.detail}</span>`;
    perks.appendChild(li);
  });
  pricingPanel.appendChild(perks);

  panels.appendChild(pricingPanel);
  infoContainer.appendChild(panels);
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
