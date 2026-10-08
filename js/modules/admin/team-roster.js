import { el, toast } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { canEditTeamRoster } from '../../core/team-management.js';
import { REGISTRATION_LIMITS } from '../../engine/formats.js';
import { reviewTeam } from '../../engine/review.js';
import { rocShort } from '../../lib/roc.js';
import { csvIdentityPending } from '../../engine/member-identity.js';
import { KIND_LABEL } from './bits.js';
import { editCsvIdentity } from './member-identity.js';

const isStaffMember = m => (m?.kind ?? m?.role ?? 'player') !== 'player';
function sortForReview(list) {
  const rows = list.filter(m => m.status === 'approved');
  return [...rows.filter(m => !isStaffMember(m)).sort((a, b) => (a.jerseyNo ?? 1000) - (b.jerseyNo ?? 1000)), ...rows.filter(isStaffMember)];
}

/** 報名審核與管理球隊共用名單檢核、私密名冊與原有修改表單。 */
export function teamRosterDetail({ team, members, division, scope, onSaved, onReload }) {
  const r = reviewTeam({ team, members, division, limits: REGISTRATION_LIMITS });
  const editable = canEditTeamRoster(team);
  return el('div', { class: 'adm__rosterDetail' }, [
    el('h3', { class: 'adm__sectionHead', text: '名單檢核' }),
    el('ul', { class: 'adm__checks' }, r.findings.map(f => el('li', { class: `adm__check adm__check--${f.level}` }, [
      icon(f.level === 'ok' ? 'check' : f.level === 'warn' ? 'info' : 'warn'),
      el('div', { class: 'adm__checkText' }, [el('span', { text: f.message }), el('span', { class: 'adm__checkSrc', text: f.source })])
    ]))),
    el('h3', { class: 'adm__sectionHead', text: `名單（球員 ${r.players}・隊職員 ${r.staff}）` }),
    editable ? el('p', { class: 'adm__note' }, iconText('note', '點選隊員旁的編輯圖示修改姓名／暱稱；已通過的 CSV 名冊也可補填背號、生日與後四碼。')) : null,
    el('ul', { class: 'adm__roster' }, sortForReview(members).map(m => el('li', {
      class: `adm__member${isStaffMember(m) ? ' adm__member--staff' : ''}`
    }, [
      el('span', { class: 'adm__no num', text: m.jerseyNo != null ? String(m.jerseyNo) : '—' }),
      el('span', { class: 'adm__memberName', text: m.name || '（未填）' }),
      el('span', { class: 'adm__memberMeta' }, isStaffMember(m)
        ? el('span', { class: 'adm__memberField', text: KIND_LABEL[m.kind || m.role] || '隊職員' })
        : [csvIdentityPending(m) ? el('span', { class: 'adm__memberPending', text: '待補資料' }) : null,
          el('span', { class: 'adm__memberField', text: m.birthDate ? `生日 ${rocShort(m.birthDate)}` : '生日待補' }),
          el('span', { class: 'adm__memberField', text: m.idLast4 ? `末四碼 ${m.idLast4}` : '末四碼待補' })]),
      editable ? el('button', {
        type: 'button', class: 'btn adm__memberEdit', 'aria-label': `補填或修改 ${m.name} 的資料`,
        title: csvIdentityPending(m) ? '補填資料' : '修改資料',
        onClick: () => editCsvIdentity({ team, member: m, division, scope, onSaved: result => {
          Object.assign(m, result); onSaved?.(result); toast('球員資料已儲存，修改紀錄已保留。', 'success');
        } })
      }, icon('note')) : null
    ]))),
    el('button', { type: 'button', class: 'btn btn--sm', onClick: onReload }, '重新載入名單')
  ]);
}
