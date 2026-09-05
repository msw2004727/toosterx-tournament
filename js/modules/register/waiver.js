/**
 * 球員配戴眼鏡上場安全切結書 `#/register/waiver`（競賽規章附件二）
 * ------------------------------------------------------------------
 * 免登入、可列印。內容照規章附件二逐條轉錄，不改字——這是法律文件。
 * 報名表單裡勾「配戴眼鏡上場」的人會連到這裡；學童組由家長紙本簽好，
 * 比賽當天帶到檢錄處。教練在名單上記「收到了沒」，檢錄台會標出來。
 */
import { el, mount } from '../../core/ui.js';
import { iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';

export async function waiverPage({ view }) {
  const root = el('div', { class: 'reg' });
  mount(view, root);

  const blank = label => el('span', { text: label });

  mount(root,
    el('div', { class: 'reg__btnRow reg__noPrint' }, [
      el('button', { class: 'btn', type: 'button', onClick: () => navigate('/register') }, iconText('back', '回報名')),
      el('button', { class: 'btn btn--primary', type: 'button', id: 'waiver-print', onClick: () => window.print() },
        iconText('note', '列印這份切結書'))
    ]),
    el('section', { class: 'reg__card reg__waiver' }, [
      el('h1', { class: 'reg__title', text: '附件二：球員配戴眼鏡上場安全切結書' }),
      el('p', { text:
        '本人（或家長／法定代理人）已知悉足球運動具計時、激烈對抗及碰撞之特性。關於球員　＿＿＿＿＿＿（以下簡稱該球員）' +
        '報名參加由臺中市足球教育發展協會（以下簡稱大會）主辦之「FEDA CUP 2026｜飛達盃」足球賽事，' +
        '因該球員個人視力需求，經審慎評估後，申請於比賽期間配戴眼鏡上場，並承諾及遵守以下切結條款：' }),

      el('h2', { text: '一、裝備安全承諾' }),
      el('p', { text:
        '該球員於比賽中所配戴之眼鏡，保證為運動專用安全防護眼鏡（如：配戴橡膠防護框、安全鏡片、無銳利邊角、並附有固定帶之防護鏡），' +
        '絕非一般日常配戴之膠框、金屬框或玻璃鏡片眼鏡。' }),
      el('p', { text: '大會裁判有權於賽前進行安全檢查，若檢查未獲通過，該球員同意更換合規裝備或不下場參賽。' }),

      el('h2', { text: '二、責任歸屬與免責聲明' }),
      el('ol', {}, [
        el('li', { text: '設備毀損：比賽過程中如因碰撞、跌倒或其他意外，導致該球員之眼鏡毀損，大會及承辦單位概不負任何賠償責任。' }),
        el('li', { text:
          '人身傷害：比賽期間若因配戴眼鏡而導致該球員自身受傷，或因碰撞造成其他參賽球員受傷，' +
          '其後續之醫療、民刑事及法律賠償責任，一律由該球員及法定代理人，與所屬球隊自行承擔，概與大會及承辦單位無涉。' })
      ]),

      el('h2', { text: '三、保險理賠認知' }),
      el('p', { text:
        '本人了解大會所投保之公共意外責任險之理賠範圍與限制，並知悉因自身配戴特定裝備（眼鏡）所衍生的特殊風險，可能不在其理賠範圍內。' }),

      el('p', { text: '此致　臺中市足球教育發展協會　賽事主辦單位' }),

      el('div', { class: 'reg__signRow' }, [
        blank('所屬球隊名稱：'),
        blank('參賽球員姓名（簽名／蓋章）：')
      ]),
      el('div', { class: 'reg__signRow' }, [
        blank('身分證字號／護照號碼：'),
        blank('法定代理人／家長姓名（球員未滿 18 歲必填）：')
      ]),
      el('div', { class: 'reg__signRow' }, [
        blank('聯絡電話：'),
        blank('中華民國 2026 年　＿＿ 月　＿＿ 日')
      ])
    ])
  );
}
