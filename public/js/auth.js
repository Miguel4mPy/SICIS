function togglePasswordVisibility(button) {
  const targetId = button.getAttribute('data-toggle-password');
  const password = document.getElementById(targetId);
  const icon = button.querySelector('i');
  if (!password) return;

  const mostrar = password.type === 'password';
  password.type = mostrar ? 'text' : 'password';

  if (icon) {
    icon.className = mostrar ? 'bi bi-eye-slash' : 'bi bi-eye';
  }

  button.setAttribute('aria-label', mostrar ? 'Ocultar contrasena' : 'Mostrar contrasena');
  button.setAttribute('aria-pressed', mostrar ? 'true' : 'false');
}

window.togglePasswordVisibility = togglePasswordVisibility;

document.addEventListener('click', event => {
  if (event.defaultPrevented) return;
  const button = event.target.closest('[data-toggle-password]');
  if (!button) return;

  event.preventDefault();
  togglePasswordVisibility(button);
});
