const query = window.matchMedia('(max-width: 760px)');

export function isPhone() {
  return query.matches;
}

export function onPhoneChange(listener) {
  query.addEventListener('change', listener);
}
