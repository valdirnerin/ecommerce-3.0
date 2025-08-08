// Utility helpers for accessing the shopping cart in localStorage.

// Retrieve cart ensuring corrupted or malformed data is cleared.
export function getCart() {
  try {
    const raw = localStorage.getItem("nerinCart");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Cart is not an array");
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id !== "undefined" &&
        typeof item.quantity === "number" &&
        item.quantity > 0
    );
  } catch (err) {
    console.warn("Cart storage invalid, resetting", err);
    localStorage.removeItem("nerinCart");
    return [];
  }
}

// Persist cart if valid array.
export function saveCart(cart) {
  if (!Array.isArray(cart)) {
    console.warn("Attempted to save invalid cart", cart);
    return;
  }
  localStorage.setItem("nerinCart", JSON.stringify(cart));
}

// Remove cart from storage.
export function clearCart() {
  localStorage.removeItem("nerinCart");
}

