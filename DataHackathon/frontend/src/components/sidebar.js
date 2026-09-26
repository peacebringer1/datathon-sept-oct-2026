export function toggleCategory(headerElement) {
  const group = headerElement.closest('.cat-group');
  if (group) {
    group.classList.toggle('open');
  }
}

export function selectIndicator(indicatorName, event, onFilterChangeCallback) {
  const select = document.getElementById('indicatorSelect');
  if (!select) return;
  
  let optionExists = false;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === indicatorName) {
      select.selectedIndex = i;
      optionExists = true;
      break;
    }
  }

  document.querySelectorAll('.subcat-item').forEach(el => el.classList.remove('active'));
  if (event && event.target) {
    event.target.classList.add('active');
  }

  if (optionExists) {
    onFilterChangeCallback();
  }
}