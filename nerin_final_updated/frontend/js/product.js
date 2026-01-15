import { fetchProducts, isWholesale } from "./api.js";
import { trackMetaEvent, resolveSku, shouldSendEventOnce } from "./meta-pixel.js";
import { applySeoDefaults, stripBrandSuffix } from "./seo-helpers.js";

const detailSection = document.getElementById("productDetail");
const galleryContainer = document.getElementById("gallery");
const infoContainer = document.getElementById("productInfo");
const lightboxElement = document.getElementById("lightbox");
const priceFormatter = new Intl.NumberFormat("es-AR");
const FALLBACK_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function getProductSlug(product) {
  if (!product || typeof product.slug !== "string") return null;
  const slug = product.slug.trim();
  return slug || null;
}

function buildRelativeProductUrl(product) {
  const slug = getProductSlug(product);
  if (slug) {
    return `/p/${encodeURIComponent(slug)}`;
  }
  const id = product?.id != null ? String(product.id) : "";
  return `/product.html?id=${encodeURIComponent(id)}`;
}

function extractSlugFromPath() {
  const path = window.location?.pathname || "";
  const match = path.match(/^\/p\/([^/]+)\/?$/);
  if (!match) return null;
  let decoded = match[1];
  try {
    decoded = decodeURIComponent(match[1]);
  } catch (err) {
    /* keep raw value */
  }
  const trimmed = decoded.trim();
  return trimmed || null;
}

function syncBrowserUrl(relativeUrl) {
  if (!relativeUrl || typeof history.replaceState !== "function") return;
  try {
    const target = new URL(relativeUrl, window.location.origin);
    const current = window.location;
    let nextSearch = target.search;
    if (target.pathname.startsWith("/p/")) {
      const params = new URLSearchParams(current.search);
      params.delete("id");
      params.delete("slug");
      const remaining = params.toString();
      nextSearch = remaining ? `?${remaining}` : "";
    }
    if (current.pathname !== target.pathname || current.search !== nextSearch) {
      const hash = current.hash || "";
      history.replaceState({}, "", target.pathname + nextSearch + hash);
    }
  } catch (err) {
    /* ignore invalid URLs */
  }
}

function getSiteBaseUrl() {
  const cfg = window.NERIN_CONFIG;
  if (cfg && typeof cfg.publicUrl === "string" && cfg.publicUrl.trim()) {
    try {
      return new URL(cfg.publicUrl.trim()).toString().replace(/\/+$/, "");
    } catch (err) {
      console.warn("URL pública inválida para SEO", err);
    }
  }
  return window.location.origin;
}

function resolveAbsoluteUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, getSiteBaseUrl()).toString();
  } catch (err) {
    try {
      return new URL(url, window.location.href).toString();
    } catch (inner) {
      return url;
    }
  }
}

function getProductDescription(product, { preferMeta = false } = {}) {
  if (!product) return "";
  const primary = preferMeta
    ? [product.seoDescription, product.meta_description, product.description, product.short_description]
    : [product.description, product.seoDescription, product.meta_description, product.short_description];
  for (const value of primary) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function resolveSeo(product) {
  const { product: enriched, generated } = applySeoDefaults(product || {});
  return {
    product: enriched,
    title: enriched.seoTitle || generated.seoTitle,
    description: enriched.seoDescription || generated.seoDescription,
  };
}

function buildModuleAltLabel(product) {
  const { title } = resolveSeo(product);
  const label = stripBrandSuffix(title) || normalizeText(product?.name);
  if (label) {
    return label.toLowerCase().startsWith("módulo")
      ? label
      : `Módulo ${label} Service Pack original`;
  }
  return "Módulo Service Pack original";
}

function buildMetaTitle(product) {
  const { title } = resolveSeo(product);
  return title;
}

function buildDensitySrcset(url) {
  if (typeof url !== "string" || !url.trim()) return "";
  return `${url} 1x, ${url} 2x`;
}

function truncateText(text, limit) {
  if (typeof text !== "string" || !text.trim()) return "";
  const normalized = normalizeText(text);
  if (normalized.length <= limit) return normalized;
  const slice = normalized.slice(0, Math.max(0, limit - 1));
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > 40 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[\s,.!?;:-]+$/, "")}…`;
}

function buildMetaDescription(product) {
  const { description } = resolveSeo(product);
  if (description) return truncateText(description, 180);
  const fallback = getProductDescription(product, { preferMeta: true });
  return truncateText(fallback || "Repuesto original Service Pack", 180);
}

function setMetaContent(attr, key, value) {
  const head = document.head;
  if (!head || !key) return;
  let meta = head.querySelector(`meta[${attr}="${key}"][data-product-meta]`);
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(attr, key);
    meta.dataset.productMeta = key;
    head.appendChild(meta);
  }
  if (typeof value === "string" && value.trim()) {
    meta.setAttribute("content", value.trim());
  }
}

function setCanonicalUrl(url) {
  if (!url) return;
  const head = document.head;
  if (!head) return;
  let canonical = head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.dataset.productMeta = "canonical";
    head.appendChild(canonical);
  }
  canonical.setAttribute("href", url);
}

function updateBreadcrumbJsonLd(product, productUrl) {
  const script = document.getElementById("product-breadcrumbs");
  if (!script || !product) return;
  const heading = stripBrandSuffix(resolveSeo(product).title) || product.name || "Producto";
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Inicio",
        item: resolveAbsoluteUrl("/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Productos",
        item: resolveAbsoluteUrl("/shop.html"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: heading,
        item: productUrl,
      },
    ],
  };
  script.textContent = JSON.stringify(breadcrumbs, null, 2);
  script.dataset.productBreadcrumbsTemplate = script.textContent;
}

function updateProductMeta(product, images) {
  if (!product) return { productUrl: resolveAbsoluteUrl(window.location.href) };
  const { product: enriched, title, description } = resolveSeo(product);
  const fallbackName =
    typeof enriched.name === "string" && enriched.name.trim()
      ? enriched.name.trim()
      : "Producto";
  const relativeUrl = buildRelativeProductUrl(enriched);
  const productUrl = resolveAbsoluteUrl(relativeUrl);
  document.title = title;
  setMetaContent("name", "description", description);
  const tags = Array.isArray(enriched.tags)
    ? enriched.tags
        .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
        .filter(Boolean)
    : [];
  if (tags.length) {
    setMetaContent("name", "keywords", tags.join(", "));
  } else {
    const fallbackKeywords = [fallbackName, enriched.brand, enriched.category]
      .filter((item) => typeof item === "string" && item.trim())
      .join(", ");
    if (fallbackKeywords) {
      setMetaContent("name", "keywords", fallbackKeywords);
    }
  }
  setCanonicalUrl(productUrl);
  setMetaContent("property", "og:title", title);
  setMetaContent("property", "og:description", description);
  setMetaContent("property", "og:url", productUrl);
  setMetaContent("name", "twitter:title", title);
  setMetaContent("name", "twitter:description", description);
  setMetaContent("name", "twitter:url", productUrl);
  return { title, description, productUrl, relativeUrl, slug: getProductSlug(enriched) };
}

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
    const shouldResolve =
      attr === "property"
        ? value === "og:image" || value === "og:url"
        : value === "twitter:image" || value === "twitter:url";
    const resolved = shouldResolve ? resolveAbsoluteUrl(content) : content;
    meta.content = resolved;
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

function updateJsonLd(product, images, productUrl) {
  if (!product) return;
  const head = document.head;
  if (!head) return;
  const heading = stripBrandSuffix(resolveSeo(product).title) || product.name || "Producto";
  const gallery = Array.isArray(images) ? images : [];
  const absoluteImages = gallery
    .filter(Boolean)
    .map((img) => resolveAbsoluteUrl(img));
  if (!absoluteImages.length && product.image) {
    absoluteImages.push(resolveAbsoluteUrl(product.image));
  }
  const availability =
    typeof product.stock === "number" && product.stock > 0
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock";
  const priceSource =
    product.price_minorista ?? product.price ?? product.price_mayorista ?? 0;
  const numericPrice = Number(priceSource);
  const formattedPrice = Number.isFinite(numericPrice)
    ? numericPrice.toFixed(2)
    : "0.00";
  const brandName =
    typeof product.brand === "string" && product.brand.trim()
      ? product.brand.trim()
      : "";
  const skuValue = resolveSku(product);
  const description = getProductDescription(product, { preferMeta: true });
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": productUrl,
    url: productUrl,
    name: heading,
    ...(absoluteImages.length ? { image: absoluteImages } : {}),
    ...(description ? { description } : {}),
    ...(skuValue ? { sku: skuValue, mpn: skuValue } : {}),
    ...(brandName ? { brand: { "@type": "Brand", name: brandName } } : {}),
    offers: {
      "@type": "Offer",
      url: productUrl,
      priceCurrency: "ARS",
      price: formattedPrice,
      availability,
      itemCondition: "https://schema.org/NewCondition",
    },
  };
  let script = head.querySelector("#product-jsonld");
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = "product-jsonld";
    head.appendChild(script);
  }
  script.textContent = JSON.stringify(schema, null, 2);
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
    img.className = "product-gallery__image product-hero-img";
    img.decoding = "async";
    img.loading = index === 0 ? "eager" : "lazy";
    img.fetchPriority = index === 0 ? "high" : "auto";
    img.src = url;
    const densitySrcset = buildDensitySrcset(url);
    if (densitySrcset) {
      img.srcset = densitySrcset;
    }
    img.sizes = "(min-width: 1280px) 40vw, (min-width: 768px) 60vw, 90vw";
    img.alt = normalizedAlts[index];
    img.draggable = false;
    img.addEventListener("error", () => {
      if (img.dataset.fallbackApplied === "true") return;
      img.dataset.fallbackApplied = "true";
      img.removeAttribute("srcset");
      img.src = FALLBACK_IMAGE;
    });
    picture.appendChild(img);
    const frame = document.createElement("div");
    frame.className = "product-hero-frame";
    frame.appendChild(picture);
    const wrapper = document.createElement("div");
    wrapper.className = "product-image-wrapper";
    wrapper.appendChild(frame);
    slide.appendChild(wrapper);
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
    thumbImg.loading = "lazy";
    thumbImg.src = url;
    const thumbSrcset = buildDensitySrcset(url);
    if (thumbSrcset) {
      thumbImg.srcset = thumbSrcset;
    }
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

function getWholesaleUnitPrice(product, quantity) {
  let discount = 0;
  if (quantity >= 20) discount = 0.15;
  else if (quantity >= 10) discount = 0.1;
  else if (quantity >= 5) discount = 0.05;
  return Math.round(Number(product.price_mayorista || 0) * (1 - discount));
}

function createQuantityControl(product) {
  const wrapper = document.createElement("div");
  wrapper.className = "product-qty-control";

  const label = document.createElement("p");
  label.className = "product-qty-label";
  label.textContent = "Seleccioná cantidad";
  wrapper.appendChild(label);

  const controls = document.createElement("div");
  controls.className = "product-qty-input";

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "product-qty-btn";
  minus.setAttribute("aria-label", "Disminuir cantidad");
  minus.textContent = "–";

  const input = document.createElement("input");
  input.type = "number";
  input.min = 1;
  input.max = product.stock || 1;
  input.value = 1;

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "product-qty-btn";
  plus.setAttribute("aria-label", "Aumentar cantidad");
  plus.textContent = "+";

  const clampValue = (value) => {
    const max = product.stock || 1;
    const numeric = Number(value) || 1;
    if (numeric < 1) return 1;
    if (numeric > max) return max;
    return numeric;
  };

  const syncValue = (value) => {
    input.value = clampValue(value);
    return Number(input.value);
  };

  minus.addEventListener("click", () => {
    syncValue(Number(input.value) - 1);
  });

  plus.addEventListener("click", () => {
    syncValue(Number(input.value) + 1);
  });

  input.addEventListener("input", () => {
    syncValue(input.value);
  });

  controls.append(minus, input, plus);
  wrapper.appendChild(controls);

  return {
    wrapper,
    input,
    getValue: () => clampValue(input.value),
    onChange: (cb) => {
      input.addEventListener("input", cb);
      minus.addEventListener("click", cb);
      plus.addEventListener("click", cb);
    },
  };
}

function renderProduct(product) {
  if (!infoContainer || !galleryContainer) return;
  const { product: enriched, title: seoTitle } = resolveSeo(product);
  product = enriched;
  const arrayImages = Array.isArray(product.images)
    ? product.images.filter(Boolean)
    : [];
  const legacy = product.image ? [product.image] : [];
  const images = arrayImages.length ? arrayImages : legacy;
  const altInput = Array.isArray(product.images_alt) ? product.images_alt : [];
  const skuLabel = product.sku || product.id || product.name || "sin-identificar";
  const moduleAlt = buildModuleAltLabel(product);
  const alts = images.map((_, i) => {
    const rawAlt = altInput[i];
    if (typeof rawAlt === "string" && rawAlt.trim()) return rawAlt.trim();
    if (moduleAlt) return moduleAlt;
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
  const metaInfo = updateProductMeta(product, images);
  syncBrowserUrl(metaInfo.relativeUrl);
  updateJsonLd(product, images, metaInfo.productUrl);
  updateBreadcrumbJsonLd(product, metaInfo.productUrl);
  const skuValue = resolveSku(product);
  const priceValue = Number(
    product.price_minorista ?? product.price ?? product.price_mayorista ?? 0,
  );
  if (skuValue && shouldSendEventOnce(`nerin:meta:view:${skuValue}`)) {
    trackMetaEvent("ViewContent", {
      content_type: "product",
      content_ids: [skuValue],
      value: Number.isFinite(priceValue) ? priceValue : 0,
      currency: "ARS",
    });
  }

  if (detailSection) {
    detailSection
      .querySelectorAll(".product-body, .product-sticky-cta")
      .forEach((node) => node.remove());
  }

  infoContainer.innerHTML = "";

  const layout = document.createElement("div");
  layout.className = "product-layout";

  const buyPanel = document.createElement("aside");
  buyPanel.className = "product-buy-panel";

  if (product.esPreview) {
    const previewBanner = document.createElement("div");
    previewBanner.className = "product-preview-banner";
    previewBanner.textContent =
      "⚠ Estás viendo un PRODUCTO DE PRUEBA (solo preview de diseño, no se vende).";
    buyPanel.appendChild(previewBanner);
  }

  const summary = document.createElement("header");
  summary.className = "product-summary product-buy-header";

  const title = document.createElement("h1");
  title.textContent = stripBrandSuffix(seoTitle) || product.name || "Producto";
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

  if (product.model) {
    const model = document.createElement("span");
    model.className = "product-meta__item";
    model.innerHTML = `<strong>Modelo:</strong> ${product.model}`;
    meta.appendChild(model);
  }

  if (product.category) {
    const category = document.createElement("span");
    category.className = "product-meta__item";
    category.innerHTML = `<strong>Categoría:</strong> ${product.category}`;
    meta.appendChild(category);
  }

  let stockCopy = "";
  if (typeof product.stock === "number") {
    const stockValue = Number(product.stock || 0);
    if (stockValue <= 0) {
      stockCopy = "Sin stock";
    } else if (stockValue <= 5) {
      stockCopy = `Stock crítico: ${stockValue} u.`;
    } else {
      stockCopy = `${stockValue} unidades disponibles`;
    }
  }

  summary.appendChild(meta);
  buyPanel.appendChild(summary);

  const purchaseCard = document.createElement("section");
  purchaseCard.className = "product-purchase-card";

  const purchaseHeader = document.createElement("div");
  purchaseHeader.className = "product-purchase-card__header";

  const purchaseTitle = document.createElement("div");
  purchaseTitle.className = "product-purchase-card__title";
  purchaseTitle.innerHTML = "<span>Resumen de compra</span>";
  purchaseHeader.appendChild(purchaseTitle);

  if (stockCopy) {
    const stockBadge = document.createElement("span");
    stockBadge.className = "product-stock-badge";
    const stockValue = Number(product.stock || 0);
    if (stockValue <= 0) {
      stockBadge.classList.add("product-stock-badge--out");
    } else if (stockValue <= 5) {
      stockBadge.classList.add("product-stock-badge--low");
    } else {
      stockBadge.classList.add("product-stock-badge--in");
    }
    stockBadge.textContent = stockCopy;
    purchaseHeader.appendChild(stockBadge);
  }

  purchaseCard.appendChild(purchaseHeader);

  const shippingBanner = document.createElement("div");
  shippingBanner.className = "product-shipping-banner";
  shippingBanner.innerHTML = `
    <div class="shipping-banner__badge" aria-hidden="true">🚚</div>
    <div class="shipping-banner__copy">
      <span class="shipping-banner__title">Envío gratis a todo el país</span>
      <span class="shipping-banner__meta">
        Despachamos a diario con empaque blindado y seguimiento en vivo.
      </span>
    </div>
  `;
  purchaseCard.appendChild(shippingBanner);

  const priceGrid = document.createElement("div");
  priceGrid.className = "product-buy-price-grid";

  const retailTier = document.createElement("article");
  retailTier.className = "price-tier price-tier--retail product-price-emphasis";
  retailTier.dataset.active = "true";
  retailTier.innerHTML = `
    <span class="price-tier__label">MINORISTA</span>
    <strong class="price-tier__value">${formatPrice(product.price_minorista)}</strong>
    <span class="price-tier__note">Precio final minorista · IVA incluido</span>
    <span class="price-tier__tax-note">Precio sin impuestos: ${formatPrice(
      Number(product.price_minorista || 0) / 1.21,
    )}</span>
  `;
  priceGrid.appendChild(retailTier);

  const wholesaleTier = document.createElement("article");
  wholesaleTier.className = "price-tier price-tier--wholesale product-price-emphasis";

  if (isWholesale()) {
    wholesaleTier.dataset.active = "true";
    wholesaleTier.innerHTML = `
      <span class="price-tier__label">MAYORISTA</span>
      <strong class="price-tier__value">${formatPrice(product.price_mayorista)}</strong>
      <span class="price-tier__note">Precio mayorista desde este valor con descuentos automáticos por cantidad.</span>
      <span class="price-tier__tax-note">Precio sin impuestos: ${formatPrice(
        Number(product.price_mayorista || 0) / 1.21,
      )}</span>
    `;
  } else {
    wholesaleTier.dataset.locked = "true";
    wholesaleTier.innerHTML = `
      <span class="price-tier__label">MAYORISTA</span>
      <strong class="price-tier__value">Ingresá para ver</strong>
      <span class="price-tier__note">Ingresá para ver tu tarifa exclusiva para técnicos y comercios</span>
    `;
    const wholesaleCta = document.createElement("a");
    wholesaleCta.href = "/login.html";
    wholesaleCta.className = "wholesale-login-link";
    wholesaleCta.textContent = "Ingresar a portal mayorista";
    wholesaleTier.appendChild(wholesaleCta);
  }

  priceGrid.appendChild(wholesaleTier);
  purchaseCard.appendChild(priceGrid);

  if (isWholesale()) {
    const wholesaleNote = document.createElement("p");
    wholesaleNote.className = "product-wholesale-note";
    wholesaleNote.textContent =
      "El precio mayorista mejora automáticamente según la cantidad seleccionada.";
    purchaseCard.appendChild(wholesaleNote);

    const tierList = document.createElement("ul");
    tierList.className = "product-wholesale-tiers product-wholesale-tiers--card";
    [
      { range: "1–4 u", discount: "Precio base" },
      { range: "5–9 u", discount: "–5%" },
      { range: "10–19 u", discount: "–10%" },
      { range: "20+ u", discount: "–15%" },
    ].forEach((tier) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${tier.range}</span><strong>${tier.discount}</strong>`;
      tierList.appendChild(li);
    });
    purchaseCard.appendChild(tierList);
  }

  if (stockCopy) {
    const stockInfo = document.createElement("p");
    stockInfo.className = "product-stock-info";
    stockInfo.textContent = stockCopy;
    purchaseCard.appendChild(stockInfo);
  }

  const qtyControl = createQuantityControl(product);
  const qtyWrapper = document.createElement("div");
  qtyWrapper.className = "product-buy-qty";
  qtyWrapper.appendChild(qtyControl.wrapper);
  purchaseCard.appendChild(qtyWrapper);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "button primary product-buy-main-cta";

  const priceLabel = document.createElement("p");
  priceLabel.className = "product-detail-unit-price";

  const taxFreeNote = document.createElement("p");
  taxFreeNote.className = "product-price-tax-note";

  const billingNote = document.createElement("p");
  billingNote.className = "product-price-footnote";
  billingNote.textContent = "Precio final minorista · Incluye IVA · Factura A/B";

  const protectionNote = document.createElement("p");
  protectionNote.className = "product-protection-note";
  protectionNote.innerHTML = `
    <a class="product-protection-link" href="/garantia.html">Compra protegida NERINParts</a>:
    módulo Samsung Service Pack original, factura A/B y soporte técnico real por WhatsApp.
  `;

  const handleAddToCart = () => {
    const qty = qtyControl.getValue();
    if (qty > (product.stock || 0)) {
      alert(`No hay stock suficiente. Disponibles: ${product.stock || 0}`);
      return;
    }
    const cart = JSON.parse(localStorage.getItem("nerinCart") || "[]");
    const existing = cart.find((item) => item.id === product.id);
    const available = product.stock;
    const sku = resolveSku(product);
    if (existing) {
      if (existing.quantity + qty > available) {
        alert(
          `Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${available}`,
        );
        return;
      }
      existing.quantity += qty;
      if (sku && !existing.sku) {
        existing.sku = sku;
      }
    } else {
      cart.push({
        id: product.id,
        sku,
        name: product.name,
        price: isWholesale()
          ? product.price_mayorista
          : product.price_minorista,
        quantity: qty,
        image: cartImage,
      });
    }
    localStorage.setItem("nerinCart", JSON.stringify(cart));
    if (window.updateNav) window.updateNav();
    if (window.showCartIndicator) {
      window.showCartIndicator();
    } else if (window.showToast) {
      window.showToast("✅ Producto agregado al carrito");
    }
    addBtn.textContent = "Añadido";
    setTimeout(() => {
      setCtaLabels();
    }, 1500);
    if (sku) {
      const unitPrice = isWholesale()
        ? product.price_mayorista
        : product.price_minorista;
      const numericUnit = Number(unitPrice ?? 0);
      const value =
        Number.isFinite(numericUnit) && Number.isFinite(qty)
          ? numericUnit * qty
          : 0;
      trackMetaEvent("AddToCart", {
        content_type: "product",
        content_ids: [sku],
        contents: [{ id: sku, quantity: qty }],
        value,
        currency: "ARS",
      });
    }
  };

  addBtn.addEventListener("click", handleAddToCart);

  const assuranceList = document.createElement("ul");
  assuranceList.className = "product-buy-assurance";
  [
    "Service Pack original Samsung (GH82-XXXXXX).",
    "Factura A/B para estudios, cadenas y laboratorios.",
    "Envíos a todo el país con seguimiento.",
    'Garantía técnica por defectos de fábrica (<a href="/garantia.html">ver términos</a>).',
    "Soporte técnico real por WhatsApp antes y después de la compra.",
  ].forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = item;
    assuranceList.appendChild(li);
  });

  purchaseCard.append(
    addBtn,
    priceLabel,
    taxFreeNote,
    billingNote,
    protectionNote,
    assuranceList,
  );

  buyPanel.appendChild(purchaseCard);

  layout.appendChild(buyPanel);
  infoContainer.appendChild(layout);

  const detailsPanel = document.createElement("section");
  detailsPanel.className = "product-body";
  detailsPanel.setAttribute("aria-label", "Descripción y detalles del producto");

  const detailsCard = document.createElement("article");
  detailsCard.className = "product-body__card";
  const detailsHeading = document.createElement("h2");
  detailsHeading.textContent = "Descripción y detalles";
  const descriptionText =
    getProductDescription(product) || "Descripción no disponible por el momento.";
  const desc = document.createElement("p");
  desc.className = "product-detail-desc";
  desc.textContent = descriptionText;
  detailsCard.append(detailsHeading, desc);
  detailsPanel.appendChild(detailsCard);

  const attrs = buildAttributes(product);
  if (attrs.children.length) {
    const specsCard = document.createElement("article");
    specsCard.className = "product-body__card product-specs-card";
    const specsHeading = document.createElement("h3");
    specsHeading.textContent = "Especificaciones técnicas";
    specsCard.append(specsHeading, attrs);
    detailsPanel.appendChild(specsCard);
  }

  const perks = document.createElement("ul");
  perks.className = "product-trust-block";
  [
    {
      title: "Retiro en sucursal",
      detail: "Coordina y retiralo sin costo en San Telmo.",
    },
    {
      title: "Pagá como quieras",
      detail: "Transferencia, tarjetas o Mercado Pago con cuotas.",
    },
    {
      title: "Despacho 24h",
      detail: "Envíos a todo el país con seguimiento en línea.",
    },
    {
      title: "Garantía técnica",
      detail: "Cobertura real por defecto de fábrica.",
    },
  ].forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${item.title}</strong><span>${item.detail}</span>`;
    perks.appendChild(li);
  });
  detailsPanel.appendChild(perks);

  if (detailSection) {
    detailSection.appendChild(detailsPanel);
  }

  const stickyCta = document.createElement("div");
  stickyCta.className = "product-sticky-cta";
  const stickyPrice = document.createElement("span");
  stickyPrice.className = "product-sticky-price";
  const stickyBtn = document.createElement("button");
  stickyBtn.type = "button";
  stickyBtn.className = "button primary product-buy-main-cta";
  stickyBtn.addEventListener("click", handleAddToCart);
  stickyCta.append(stickyPrice, stickyBtn);
  if (detailSection) {
    detailSection.appendChild(stickyCta);
  }

  const updatePriceLabels = () => {
    const qty = qtyControl.getValue();
    const wholesaleUser = isWholesale();
    const unitPrice = wholesaleUser
      ? getWholesaleUnitPrice(product, qty)
      : product.price_minorista;
    const unitLabel = wholesaleUser
      ? "Precio mayorista por unidad"
      : "Precio minorista por unidad";
    priceLabel.textContent = `${unitLabel}: ${formatPrice(unitPrice)} · x${qty}`;
    const netUnitPrice = Number(unitPrice) / 1.21;
    const netText = Number.isFinite(netUnitPrice)
      ? formatPrice(netUnitPrice)
      : formatPrice(0);
    taxFreeNote.textContent = `Precio sin impuestos: ${netText}`;
    const stickyLabel = wholesaleUser ? "Mayorista" : "Minorista";
    stickyPrice.textContent = `${stickyLabel}: ${formatPrice(unitPrice)} · x${qty} u · Service Pack original`;
  };

  const setCtaLabels = () => {
    const isMobile = window.matchMedia("(max-width: 768px)").matches;
    const label = isMobile ? "COMPRAR MÓDULO AHORA" : "COMPRAR AHORA";
    addBtn.textContent = label;
    stickyBtn.textContent = label;
  };

  qtyControl.onChange(() => {
    updatePriceLabels();
  });

  updatePriceLabels();
  setCtaLabels();
  window.matchMedia("(max-width: 768px)").addEventListener("change", setCtaLabels);
}

async function fetchPreviewProduct() {
  try {
    const res = await fetch("/api/dev/preview-product", { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    console.warn("preview-product", err);
    return null;
  }
}

async function initProduct() {
  if (!detailSection) return;
  const previewMode = window.location.pathname.startsWith("/dev/product-preview");
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const rawSlugParam = params.get("slug");
  const slugParam =
    typeof rawSlugParam === "string" && rawSlugParam.trim()
      ? rawSlugParam.trim()
      : null;
  const pathSlug = extractSlugFromPath();
  const targetSlug = pathSlug || slugParam;
  if (!targetSlug && !id && !previewMode) {
    if (infoContainer)
      infoContainer.innerHTML = "<p>Producto no especificado.</p>";
    return;
  }
  try {
    if (previewMode) {
      const previewProduct = await fetchPreviewProduct();
      if (previewProduct) {
        renderProduct(previewProduct);
        return;
      }
    }

    const products = await fetchProducts();
    let product = null;
    if (targetSlug) {
      product = products.find((p) => getProductSlug(p) === targetSlug);
    }
    if (!product && id) {
      product = products.find((p) => String(p.id) === String(id));
    }
    if (!product && !products.length) {
      const previewProduct = await fetchPreviewProduct();
      if (previewProduct) {
        renderProduct(previewProduct);
        return;
      }
    }
    if (!product) {
      if (infoContainer)
        infoContainer.innerHTML = "<p>Producto no encontrado.</p>";
      if (galleryContainer) galleryContainer.innerHTML = "";
      return;
    }
    renderProduct(product);
  } catch (err) {
    if (infoContainer)
      infoContainer.innerHTML = `<p>Error al cargar producto: ${err.message}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", initProduct);
