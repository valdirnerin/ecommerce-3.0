import { fetchProducts, isWholesale, getUserRole } from './api.js';

// Referencias a elementos del DOM
const productGrid = document.getElementById('productGrid');
const searchInput = document.getElementById('searchInput');
const brandFilter = document.getElementById('brandFilter');
const modelFilter = document.getElementById('modelFilter');
const categoryFilter = document.getElementById('categoryFilter');

// Almacenar productos cargados globalmente
let allProducts = [];

// Calcular precio con descuento según cantidad para mayorista
function calculateDiscountedPrice(basePrice, quantity) {
  let discount = 0;
  if (quantity >= 20) {
    discount = 0.15;
  } else if (quantity >= 10) {
    discount = 0.10;
  } else if (quantity >= 5) {
    discount = 0.05;
  }
  return Math.round(basePrice * (1 - discount));
}

// Crear tarjeta de producto
function createProductCard(product) {
  const card = document.createElement('div');
  card.className = 'product-card';

  const img = document.createElement('img');
  img.src = product.image;
  img.alt = product.name;
  card.appendChild(img);

  const title = document.createElement('h3');
  title.textContent = product.name;
  card.appendChild(title);

  const sku = document.createElement('div');
  sku.className = 'sku';
  sku.textContent = product.sku;
  card.appendChild(sku);

  const desc = document.createElement('p');
  desc.className = 'description';
  desc.textContent = product.description;
  card.appendChild(desc);

  // Mostrar atributos adicionales (categoría, peso, dimensiones, color)
  const attrs = document.createElement('ul');
  attrs.className = 'attributes';
  if (product.category) {
    const li = document.createElement('li');
    li.textContent = `Categoría: ${product.category}`;
    attrs.appendChild(li);
  }
  if (product.weight) {
    const li = document.createElement('li');
    li.textContent = `Peso: ${product.weight} g`;
    attrs.appendChild(li);
  }
  if (product.dimensions) {
    const li = document.createElement('li');
    li.textContent = `Dimensiones: ${product.dimensions}`;
    attrs.appendChild(li);
  }
  if (product.color) {
    const li = document.createElement('li');
    li.textContent = `Color: ${product.color}`;
    attrs.appendChild(li);
  }
  card.appendChild(attrs);

  // Etiqueta VIP
  if (product.vip_only) {
    const vipTag = document.createElement('span');
    vipTag.className = 'vip-tag';
    vipTag.textContent = 'Exclusivo VIP';
    card.appendChild(vipTag);
  }

  // Etiqueta de disponibilidad
  // Mostrar etiqueta "Sin stock" siempre que no haya unidades disponibles,
  // independientemente de que el campo `min_stock` esté definido. Si hay
  // stock pero está por debajo del mínimo configurado, mostrar "Poco stock".
  if (typeof product.stock === 'number') {
    const tag = document.createElement('span');
    if (product.stock <= 0) {
      tag.className = 'out-stock-tag';
      tag.textContent = 'Sin stock';
    } else if (typeof product.min_stock === 'number' && product.stock < product.min_stock) {
      tag.className = 'low-stock-tag';
      tag.textContent = 'Poco stock';
    }
    if (tag.textContent) {
      card.appendChild(tag);
    }
  }

  const priceDiv = document.createElement('div');
  priceDiv.className = 'price';
  priceDiv.textContent = `$${product.price_minorista.toLocaleString('es-AR')}`;

  // Mostrar precio mayorista si aplica
  if (isWholesale()) {
    const mayoristaSpan = document.createElement('span');
    mayoristaSpan.className = 'mayorista';
    mayoristaSpan.textContent = `Mayorista: $${product.price_mayorista.toLocaleString('es-AR')}`;
    priceDiv.appendChild(mayoristaSpan);
  }
  card.appendChild(priceDiv);

  // Crear contenedor para agregar al carrito
  const cartDiv = document.createElement('div');
  cartDiv.className = 'add-to-cart';
  if (isWholesale()) {
    // Mayorista: permitir seleccionar cantidad y usar precio mayorista con descuento
    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = 1;
    qtyInput.value = 1;
    if (typeof product.stock === 'number') {
      qtyInput.max = product.stock;
    }
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Agregar';
    // Actualizar precio con descuento al cambiar la cantidad
    qtyInput.addEventListener('input', () => {
      const qty = parseInt(qtyInput.value, 10) || 1;
      if (qty < 1) qtyInput.value = 1;
      if (typeof product.stock === 'number' && qty > product.stock) qtyInput.value = product.stock;
      const discounted = calculateDiscountedPrice(product.price_mayorista, qty);
      const mayoristaSpan = priceDiv.querySelector('.mayorista');
      if (mayoristaSpan) {
        mayoristaSpan.textContent = `Mayorista: $${discounted.toLocaleString('es-AR')} (x${qty})`;
      }
    });
    addBtn.addEventListener('click', () => {
      const qty = parseInt(qtyInput.value, 10) || 1;
      const available = typeof product.stock === 'number' ? product.stock : Infinity;
      if (qty > available) {
        alert(`No hay stock suficiente. Disponibles: ${available}`);
        qtyInput.value = available;
        return;
      }
      const cart = JSON.parse(localStorage.getItem('nerinCart') || '[]');
      const existing = cart.find((item) => item.id === product.id);
      if (existing) {
        const newQty = existing.quantity + qty;
        if (newQty > available) {
          alert(`Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${available}`);
          return;
        }
        existing.quantity = newQty;
      } else {
        cart.push({ id: product.id, name: product.name, price: product.price_mayorista, quantity: qty });
      }
      localStorage.setItem('nerinCart', JSON.stringify(cart));
      addBtn.textContent = 'Añadido';
      setTimeout(() => {
        addBtn.textContent = 'Agregar';
      }, 2000);
      if (window.updateNav) window.updateNav();
    });
    cartDiv.appendChild(qtyInput);
    cartDiv.appendChild(addBtn);
  } else {
    // Minorista o invitado: solo añadir 1 unidad con precio minorista
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Agregar';
    addBtn.addEventListener('click', () => {
      // No permitir agregar si no hay stock
      if (typeof product.stock === 'number' && product.stock <= 0) {
        alert('Sin stock disponible');
        return;
      }
      const cart = JSON.parse(localStorage.getItem('nerinCart') || '[]');
      const existing = cart.find((item) => item.id === product.id);
      const available = typeof product.stock === 'number' ? product.stock : Infinity;
      if (existing) {
        if (existing.quantity + 1 > available) {
          alert(`Ya tienes ${existing.quantity} unidades en el carrito. Disponibles: ${available}`);
          return;
        }
        existing.quantity += 1;
      } else {
        cart.push({ id: product.id, name: product.name, price: product.price_minorista, quantity: 1 });
      }
      localStorage.setItem('nerinCart', JSON.stringify(cart));
      addBtn.textContent = 'Añadido';
      setTimeout(() => {
        addBtn.textContent = 'Agregar';
      }, 2000);
      if (window.updateNav) window.updateNav();
    });
    cartDiv.appendChild(addBtn);
  }
  // Contenedor de acciones (agregar y más info)
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'product-actions';
  if (cartDiv.childNodes.length > 0) {
    actionsDiv.appendChild(cartDiv);
  }
  const infoBtn = document.createElement('button');
  infoBtn.className = 'button secondary info-btn';
  infoBtn.textContent = 'Más info';
  infoBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    window.location.href = `/product.html?id=${product.id}`;
  });
  actionsDiv.appendChild(infoBtn);
  card.appendChild(actionsDiv);

  // Hacer clic en la tarjeta para ver el detalle, excepto cuando se hace clic en el área de agregar al carrito
  card.addEventListener('click', (evt) => {
    // Evitar navegar si se hace clic en el botón o input de cantidad
    if (evt.target.tagName === 'BUTTON' || evt.target.tagName === 'INPUT') {
      return;
    }
    window.location.href = `/product.html?id=${product.id}`;
  });
  return card;
}

// Mostrar productos en el grid de acuerdo a filtros
function renderProducts() {
  productGrid.innerHTML = '';
  const search = searchInput.value.toLowerCase();
  const brandVal = brandFilter.value;
  const modelVal = modelFilter.value;
  const role = getUserRole();
  const categoryVal = categoryFilter ? categoryFilter.value : '';
  const filtered = allProducts.filter((p) => {
    // Ocultar productos exclusivos de VIP si el usuario no es VIP ni admin
    if (p.vip_only && role !== 'vip' && role !== 'admin') return false;
    const matchesSearch = p.name.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search);
    const matchesBrand = !brandVal || p.brand === brandVal;
    const matchesModel = !modelVal || p.model === modelVal;
    const matchesCategory = !categoryVal || p.category === categoryVal;
    return matchesSearch && matchesBrand && matchesModel && matchesCategory;
  });
  if (filtered.length === 0) {
    const msg = document.createElement('p');
    msg.textContent = 'No se encontraron productos.';
    productGrid.appendChild(msg);
  } else {
    filtered.forEach((product) => {
      const card = createProductCard(product);
      productGrid.appendChild(card);
    });
  }
}

// Rellenar selectores de marca y modelo con valores únicos
function populateFilters(products) {
  const brands = Array.from(new Set(products.map((p) => p.brand)));
  const models = Array.from(new Set(products.map((p) => p.model)));
  const categories = Array.from(new Set(products.map((p) => p.category).filter((c) => c)));
  brands.forEach((b) => {
    const option = document.createElement('option');
    option.value = b;
    option.textContent = b;
    brandFilter.appendChild(option);
  });
  models.forEach((m) => {
    const option = document.createElement('option');
    option.value = m;
    option.textContent = m;
    modelFilter.appendChild(option);
  });

  if (categoryFilter) {
    categories.forEach((c) => {
      const option = document.createElement('option');
      option.value = c;
      option.textContent = c;
      categoryFilter.appendChild(option);
    });
  }
}

// Inicializar
async function initShop() {
  try {
    allProducts = await fetchProducts();
    populateFilters(allProducts);
    renderProducts();
    searchInput.addEventListener('input', renderProducts);
    brandFilter.addEventListener('change', renderProducts);
    modelFilter.addEventListener('change', renderProducts);
    if (categoryFilter) {
      categoryFilter.addEventListener('change', renderProducts);
    }
  } catch (err) {
    productGrid.innerHTML = `<p>Error al cargar productos: ${err.message}</p>`;
  }
}

// Ejecutar al cargar el documento
document.addEventListener('DOMContentLoaded', initShop);