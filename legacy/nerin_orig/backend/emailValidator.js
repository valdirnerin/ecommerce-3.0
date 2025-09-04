async function verifyEmail(email) {
  const apiKey = process.env.EMAIL_VERIFICATION_API_KEY;
  if (!apiKey) return true;
  const url = `https://emailvalidation.abstractapi.com/v1/?api_key=${apiKey}&email=${encodeURIComponent(email)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.deliverability === 'DELIVERABLE';
  } catch {
    return false;
  }
}

module.exports = verifyEmail;
