import { can, isAdmin, user, db, sdk } from './firebase.js';
import { hold } from './store.js';
import { EVENT_ID } from '../config.js';

export const canManageAllTeams = () => can('team.manage') && isAdmin();
export const canEditTeamRoster = team => canManageAllTeams()
  || (!!user() && team?.captainUid === user().uid && team.managementLocked !== true);

/** 隊長指派與撤銷即時反映；查詢只取目前帳號所屬球隊。 */
export function watchCaptainTeams(scope, uid, cb, onError) {
  const { collection, query, where, onSnapshot } = sdk();
  return hold(scope, onSnapshot(query(collection(db(), 'events', EVENT_ID, 'teams'),
    where('captainUid', '==', uid)), snap => cb(snap.docs.map(d => ({ ...d.data(), teamId: d.id }))
      .sort((a, b) => (a.name || a.teamId).localeCompare(b.name || b.teamId, 'zh-TW'))), onError), 'teams:captain');
}
