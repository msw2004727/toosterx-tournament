/** 公開入口共用同一份即時設定，讀不到時不顯示報名。 */
import { db, sdk } from './firebase.js';
import { hold } from './store.js';
export const registrationVisible = cfg => !!cfg && cfg.hidden !== true;
export function watchRegistrationVisibility(scope, cb) {
  const { doc, onSnapshot } = sdk();
  return hold(scope, onSnapshot(doc(db(), 'config', 'registration'),
    snap => cb(registrationVisible(snap.exists() ? snap.data() : null)), () => cb(false)), 'registration:visibility');
}
