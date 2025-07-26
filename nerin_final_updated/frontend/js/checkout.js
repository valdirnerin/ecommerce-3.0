const steps = ["Datos", "Envío", "Pago", "Revisión"];
let current = parseInt(sessionStorage.getItem("checkoutStep") || "0", 10);
const stepper = document.getElementById("stepper");
const content = document.getElementById("stepContent");
const prevBtn = document.getElementById("prevStep");
const nextBtn = document.getElementById("nextStep");

function renderStepper() {
  stepper.innerHTML = "";
  steps.forEach((s, idx) => {
    const div = document.createElement("div");
    div.className = "step" + (idx === current ? " active" : "");
    div.textContent = `${idx + 1}. ${s}`;
    stepper.appendChild(div);
  });
  prevBtn.disabled = current === 0;
  nextBtn.textContent =
    current === steps.length - 1 ? "Finalizar" : "Siguiente";
}

function renderStep() {
  renderStepper();
  if (current === 0) {
    content.innerHTML = `
      <label>Nombre<br /><input id="name" /></label><br />
      <label>Email<br /><input id="email" type="email" /></label>`;
  } else if (current === 1) {
    content.innerHTML = `
      <label>Dirección<br /><input id="address" /></label><br />
      <label>Código Postal<br /><input id="zip" /></label>`;
  } else if (current === 2) {
    content.innerHTML = `<p>Al continuar se generará la orden y se abrirá Mercado Pago.</p>`;
  } else {
    const orderId = sessionStorage.getItem("createdOrderId") || "";
    content.innerHTML = `<p>Pedido creado: ${orderId}</p>`;
  }
  sessionStorage.setItem("checkoutStep", String(current));
}

prevBtn.addEventListener("click", () => {
  if (current > 0) {
    current -= 1;
    renderStep();
  }
});

nextBtn.addEventListener("click", async () => {
  if (current === 2) {
    const items = JSON.parse(localStorage.getItem("nerinCart") || "[]");
    const customer = {
      name: document.getElementById("name").value,
      email: document.getElementById("email").value,
    };
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, customer }),
    });
    if (res.ok) {
      const data = await res.json();
      sessionStorage.setItem("createdOrderId", data.orderId);
      const prefRes = await fetch("/api/mercadopago/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({
            title: i.name,
            quantity: i.quantity,
            unit_price: i.price,
          })),
          external_reference: data.orderId,
        }),
      });
      if (prefRes.ok) {
        const pref = await prefRes.json();
        window.location.href = pref.preference.init_point;
        return;
      }
    }
  }
  if (current < steps.length - 1) {
    current += 1;
    renderStep();
  } else {
    window.location.href = "/account.html";
  }
});

renderStep();
