import './fonts.js';
import './styles/base.css';
import './styles/inner.css';
import { api, downloadUrl } from './lib/api.js';
import { actaRow } from './lib/actas.js';
import { $, h } from './lib/dom.js';
import { fmt, verdict } from './lib/format.js';
import { normalize } from './lib/text.js';

const PAGE = 30;
let all = [];
let filtered = [];
let shown = PAGE;

function render() {
  const body = $('actas-body');
  if (!filtered.length) {
    const msg = all.length ? 'Ninguna proposición contiene esas palabras.' : 'Todavía no se ha cerrado ninguna sesión. Vuelva mañana.';
    body.replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'actas-empty' }, msg)));
  } else {
    body.replaceChildren(...filtered.slice(0, shown).map(actaRow));
  }
  $('more').hidden = filtered.length <= shown;
}

function renderStats() {
  const votes = all.reduce((n, s) => n + s.results.total, 0);
  const verdicts = all.map((s) => (s.results.total ? verdict(s.results) : null));
  $('stat-sessions').textContent = fmt.format(all.length);
  $('stat-votes').textContent = fmt.format(votes);
  $('stat-approved').textContent = fmt.format(verdicts.filter((v) => v === 'aprobada').length);
  $('stat-rejected').textContent = fmt.format(verdicts.filter((v) => v === 'rechazada').length);
}

async function init() {
  $('download-csv').href = downloadUrl('csv');
  $('download-json').href = downloadUrl('json');

  // El archivo paginado trae además «su voto» de cada sesión.
  const [history, mine] = await Promise.all([api('/api/historico.json'), api('/api/archivo?limite=50')]);
  if (!history.ok) {
    $('actas-body').replaceChildren(h('tr', {}, h('td', { colspan: 6, class: 'actas-empty' }, 'No se ha podido abrir el libro de actas.')));
    return;
  }
  const myBalls = new Map((mine.data.items ?? []).map((s) => [s.day, s.myBall]));
  all = history.data.sessions.map((s) => ({ ...s, myBall: myBalls.get(s.day) ?? null }));
  filtered = all;
  renderStats();
  render();

  let timer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = normalize(e.target.value);
      filtered = q ? all.filter((s) => normalize(s.text).includes(q)) : all;
      shown = PAGE;
      render();
    }, 120);
  });
  $('more').addEventListener('click', () => {
    shown += PAGE;
    render();
  });
}

init();
