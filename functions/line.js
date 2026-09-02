/**
 * LINE 登入
 * ------------------------------------------------------------------
 * 規格：docs/07 §3.2 `lineLogin`、docs/10 §1.4、§8.5
 *
 * 流程：
 *   前端（LIFF）拿到 idToken
 *     → 這裡向 LINE 驗證，取回 sub（= LINE userId）
 *     → 用 **sub 當 Firebase uid** 發 custom token
 *     → 前端 signInWithCustomToken
 *
 * ⚠️ uid **必須**直接用 LINE userId，不可以另外編一組。
 *    FC-Football 已經是這樣做的，兩邊 uid 一致才對得起來——
 *    `teams/{id}.captainUid` 與 FC 的 `users/{uid}` 是同一把鍵（docs/10 §8.5）。
 *    這件事不共用資料庫也成立，但前提是 uid 一模一樣。
 *
 * ⚠️ 驗證 idToken **不需要 Channel secret**：LINE 的 /oauth2/v2.1/verify
 *    只要 id_token 與 client_id（＝ Channel ID，公開值）。
 *    secret 是換 access token 時才用得到，我們沒有走那條路，
 *    所以不必為了登入把 secret 放進 Function（R-SEC-001 的面積越小越好）。
 */
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin.js';

const LINE_VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_ISSUER = 'https://access.line.me';

/**
 * 這一份設定放 Firestore 而不是寫死在程式裡：
 * 兩個專案各有自己的 Channel，而 Channel 換掉時不該需要重新部署 Function。
 * **讀不到就整個拒絕登入**——fail-closed。沒有 channelId 就沒辦法驗證
 * 「這個 token 是發給我們的」，那時候放行等於誰的 token 都收。
 */
export async function liffConfig() {
  const snap = await db().doc('config/liff').get();
  const channelId = snap.exists ? snap.data().channelId : null;
  if (!channelId) throw new Error('config/liff.channelId 不存在，無法驗證 LINE 登入');
  return { channelId: String(channelId), liffId: snap.data().liffId ?? null };
}

/**
 * 檢查 LINE 回傳的 payload。抽成純函式才測得到——
 * 這是整條登入鏈唯一「判斷要不要相信對方」的地方。
 *
 * @throws 任何一項不符就丟錯，不回傳 false（呼叫端不會忘記檢查回傳值）
 */
export function assertLinePayload(payload, channelId) {
  if (!payload || typeof payload !== 'object') throw new Error('LINE 沒有回傳可用的內容');

  // aud 必須是**我們的** Channel。少了這一條，任何人拿別的 LINE 應用程式
  // 發出的 token 都能登入我們的系統。
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(String(channelId))) throw new Error('這個 token 不是發給本應用程式的');

  if (payload.iss !== LINE_ISSUER) throw new Error(`簽發者不是 LINE（iss=${payload.iss}）`);
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('token 裡沒有 userId');

  return {
    uid: payload.sub,
    displayName: typeof payload.name === 'string' ? payload.name : null,
    pictureUrl: typeof payload.picture === 'string' ? payload.picture : null
  };
}

/** 向 LINE 驗證 idToken。錯誤訊息保留 LINE 給的原因，現場才查得到。 */
export async function verifyLineIdToken(idToken, channelId) {
  const res = await fetch(LINE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: String(channelId) })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`LINE 驗證失敗（${res.status}）：${body.error_description || body.error || '未知原因'}`);
  }
  return assertLinePayload(body, channelId);
}

/**
 * 留下使用者名錄（docs/10 §1.4）。
 * LINE 的 userId 沒辦法憑空查，大總管要有一份名單才指派得了身分。
 *
 * roles 是**快取**，權威永遠是 staff/{uid}.roles——所以這裡從 staff 讀出來寫進去，
 * 而不是相信前端傳了什麼。
 */
export async function upsertUser({ uid, displayName, pictureUrl }) {
  const userRef = db().doc(`users/${uid}`);
  const [userSnap, staffSnap] = await Promise.all([
    userRef.get(),
    db().doc(`staff/${uid}`).get()
  ]);

  const staff = staffSnap.exists && staffSnap.data().active === true ? staffSnap.data() : null;
  const roles = staff?.roles ?? [];

  await userRef.set({
    uid, displayName, pictureUrl,
    firstSeenAt: userSnap.exists ? (userSnap.data().firstSeenAt ?? FieldValue.serverTimestamp())
                                 : FieldValue.serverTimestamp(),
    lastSeenAt: FieldValue.serverTimestamp(),
    roles
  }, { merge: true });

  return { roles, isStaff: roles.length > 0 };
}

/**
 * 完整的登入流程。回傳 custom token 與這個人的身分。
 *
 * @param {string} idToken 前端 liff.getIDToken() 拿到的
 */
export async function loginWithLine(idToken) {
  if (typeof idToken !== 'string' || !idToken) throw new Error('缺少 idToken');

  const { channelId } = await liffConfig();
  const profile = await verifyLineIdToken(idToken, channelId);
  const { roles, isStaff } = await upsertUser(profile);

  // uid 就是 LINE userId，不做任何轉換（docs/10 §8.5）
  //
  // ⚠️ createCustomToken() 在 Cloud Functions 上是透過 IAM Credentials 的
  //    signBlob 簽出來的，需要執行身分對**自己**有 `iam.serviceAccounts.signBlob`。
  //    預設的 compute 服務帳戶只有 roles/editor，而 **editor 不含 signBlob**
  //    （已用 `gcloud iam roles describe roles/editor` 確認）。
  //    少了這個授權，部署會成功、探索會成功、只有真的有人登入時才會炸。
  //    授權方式見 docs/11 §1.5。
  const customToken = await getAuth().createCustomToken(profile.uid);

  return {
    customToken,
    profile: { uid: profile.uid, displayName: profile.displayName, pictureUrl: profile.pictureUrl },
    roles, isStaff
  };
}
