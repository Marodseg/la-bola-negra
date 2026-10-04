import { h } from './dom.js';
import { fmt, formatShortDate, percents, verdict, VERDICT_LABEL } from './format.js';

export const BALL_NAME = { blanca: 'bola blanca', negra: 'bola negra' };

/** Fila del libro de actas. */
export function actaRow(item) {
  const r = item.results;
  const pct = percents(r);
  const v = verdict(r);
  return h('tr', {},
    h('td', { class: 'actas-n' }, fmt.format(item.number)),
    h('td', { class: 'actas-date' }, h('time', { datetime: item.day }, formatShortDate(item.day))),
    h('td', { class: 'actas-q' }, item.text, item.myBall ? h('span', { class: 'actas-mine' }, `Su voto: ${BALL_NAME[item.myBall]}`) : null),
    h('td', { class: 'num', 'data-label': 'Blancas' }, fmt.format(r.blanca), h('span', { class: 'actas-pct' }, `${pct.blanca} %`)),
    h('td', { class: 'num', 'data-label': 'Negras' }, fmt.format(r.negra), h('span', { class: 'actas-pct' }, `${pct.negra} %`)),
    h('td', { class: 'actas-result' }, r.total ? h('span', { class: `seal seal--${v}` }, VERDICT_LABEL[v]) : h('span', { class: 'actas-pct' }, 'Sin votos')),
  );
}
