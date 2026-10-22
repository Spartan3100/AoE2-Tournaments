// Shows the Windows app's version next to its download link.
(() => {
  const ver = document.querySelector('#rv-helper-ver [data-source="helper_app"]');
  dash.onData(() => {
    const d = dash.data('helper_app');
    ver.textContent = d.status === 'ok' && d.data[0] ? String(d.data[0].version) : '—';
  });
})();
