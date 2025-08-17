/*
 * API helper functions para el frontend de NERIN.
 *
 * Proporciona funciones para interactuar con el backend obteniendo datos de
 * productos, pedidos, clientes, proveedores y tabla de envíos. También incluye
 * helpers de autenticación y utilidades varias.
 */

import { asProduct, asClient, asOrder, asSupplier, asShippingRow } from './dataAdapters.js';

// Base URL del backend. Cuando se despliegue en producción, ajustar según
// corresponda. Para desarrollo local suele ser la misma URL de origen.
const API_BASE = '';

// Helper seguro para obtener JSON
export async function fetchJsonSafe(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 204 || res.status === 404) return [];
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// ----------- Recursos principales ------------
export async function getProducts() {
  const data = await fetchJsonSafe(`${API_BASE}/api/products`);
  const list = Array.isArray(data.products)
    ? data.products
    : Array.isArray(data)
    ? data
    : [];
  return list.map(asProduct);
}

export async function getOrders(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const data = await fetchJsonSafe(`${API_BASE}/api/orders${qs ? `?${qs}` : ''}`);
  const list = Array.isArray(data.orders)
    ? data.orders
    : Array.isArray(data)
    ? data
    : [];
  return list.map(asOrder);
}

export async function getClients() {
  const data = await fetchJsonSafe(`${API_BASE}/api/clients`);
  const list = Array.isArray(data.clients)
    ? data.clients
    : Array.isArray(data)
    ? data
    : [];
  return list.map(asClient);
}

export async function getSuppliers() {
  const data = await fetchJsonSafe(`${API_BASE}/api/suppliers`);
  const list = Array.isArray(data.suppliers)
    ? data.suppliers
    : Array.isArray(data)
    ? data
    : [];
  return list.map(asSupplier);
}

export async function createSupplier(body) {
  const res = await fetch(`${API_BASE}/api/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('createSupplier failed');
  return getSuppliers();
}

export async function getShippingTable() {
  const data = await fetchJsonSafe(`${API_BASE}/api/shipping-table`);
  const list = Array.isArray(data) ? data : [];
  return list.map(asShippingRow);
}

export async function saveShippingTable(rows) {
  const payload = rows.map(asShippingRow);
  const res = await fetch(`${API_BASE}/api/shipping-table`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ costos: payload }),
  });
  if (!res.ok) throw new Error('saveShippingTable failed');
  return getShippingTable();
}

// ----------- Autenticación y utilidades existentes ------------

// Iniciar sesión. Devuelve objeto con success, token y role
export async function login(email, password) {
  const res = await fetch(`${API_BASE}/api/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  if (res.ok) {
    const data = await res.json();
    localStorage.setItem('nerinToken', data.token);
    localStorage.setItem('nerinUserRole', data.role);
    localStorage.setItem('nerinUserName', data.name);
    localStorage.setItem('nerinUserEmail', email);
    localStorage.setItem('nerinLastLogin', new Date().toISOString());
    return data;
  } else {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.message || 'Error de autenticación');
  }
}

// Obtener rol de usuario almacenado
export function getUserRole() {
  return localStorage.getItem('nerinUserRole');
}

// Cerrar sesión
export function logout() {
  localStorage.removeItem('nerinToken');
  localStorage.removeItem('nerinUserRole');
  localStorage.removeItem('nerinUserName');
}

// Determinar si el usuario es mayorista (ver precios mayoristas)
export function isWholesale() {
  const role = getUserRole();
  return role === 'mayorista' || role === 'admin' || role === 'vip';
}

