import { login } from "./api.js";

const form = document.getElementById("loginForm");
const errorDiv = document.getElementById("error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  errorDiv.style.display = "none";
  try {
    const data = await login(email, password);
    // Según el rol, redirigir al panel o a la tienda
    const role = data.role;
    if (role === "admin" || role === "vendedor") {
      window.location.href = "/admin.html";
    } else {
      window.location.href = "/shop.html";
    }
  } catch (err) {
    errorDiv.textContent = err.message;
    errorDiv.style.display = "block";
  }
});
