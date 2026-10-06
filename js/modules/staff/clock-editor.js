import { el, mount, toast } from '../../core/ui.js';
import { iconText } from '../../core/icons.js';
import { hold } from '../../core/store.js';
import { elapsedSec, now } from '../../core/clock.js';
import { clockText } from '../../lib/format.js';
import { buildClockCorrection, clockLimitSec } from '../../engine/match-clock.js';
import { correctMatchClock, explain } from '../admin/data.js';
export function openClockEditor({ scope, match, division, context, onSaved }) {
  const focus = document.activeElement;
  let busy = false, active = true;
  const off = hold(scope, () => close(true), 'clock:editor');
  const sec = Math.floor(elapsedSec(match.clock, now()));
  const field = (label, input) => el('label', { class:'event-edit__field' }, [el('span',{text:label}),input]);
  const minutes = el('input', { class:'input num', name:'minutes', type:'number', inputmode:'numeric', min:0, max:1440, step:1, required:true, value:Math.floor(sec/60) });
  const seconds = el('input', { class:'input num', name:'seconds', type:'number', inputmode:'numeric', min:0, max:59, step:1, required:true, value:sec%60 });
  const reason = el('textarea', { class:'input', name:'reason', rows:2, required:true, maxlength:500, placeholder:'例如：核對裁判紀錄後修正時間' });
  const preview = el('p',{class:'event-edit__preview','aria-live':'polite'});
  const error = el('p',{class:'event-edit__error',role:'alert',hidden:true});
  const save = el('button',{class:'btn btn--primary',type:'submit'},iconText('check','儲存時間'));
  const cancel = el('button',{class:'btn btn--ghost',type:'button',onClick:()=>close()},'取消');
  const form = el('form',{class:'event-edit'}, [el('div',{class:'event-edit__time'},[field('比賽分鐘',minutes),field('秒數',seconds)]),preview,field('修改原因',reason),error,el('div',{class:'modal__actions'},[cancel,save])]);
  const dlg=el('div',{class:'modal',role:'dialog','aria-modal':'true','aria-label':'修改比賽時間'},el('div',{class:'modal__panel event-edit__panel'},[
    el('h2',{class:'modal__title'},iconText('clock','修改比賽時間')),
    el('p',{class:'event-edit__intro',text:match.clock?.running && context==='live' ? '修改後會從新時間繼續計時；超過正規時間的部分自動計為補時。' : '超過正規時間的部分自動計為補時，儲存後保留修改紀錄。'}),form]));
  function close(force=false) { if (!active || busy && !force) return; active=false; document.removeEventListener('keydown',key); dlg.remove(); off(); if(focus?.isConnected)focus.focus(); }
  function key(e) {
    if(e.key==='Escape')close();
    if(e.key==='Tab') { const list=[...dlg.querySelectorAll('input:not([disabled]),textarea:not([disabled]),button:not([disabled])')]; const first=list[0],last=list.at(-1);
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();} else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();} }
  }
  const value=()=>Number(minutes.value)*60+Number(seconds.value);
  function refresh() { try { const c=buildClockCorrection({match,division,seconds:value(),nowMs:now()}); preview.textContent=`正規時間 ${clockText(clockLimitSec(match,division))} · 補時 ${clockText(c.addedTimeSec)}`; } catch(e) { preview.textContent=e.message; } }
  form.addEventListener('input',refresh); refresh();
  form.addEventListener('submit',async e=>{
    e.preventDefault(); if(busy)return;
    try { buildClockCorrection({match,division,seconds:value(),nowMs:now()}); } catch(e){error.hidden=false;error.textContent=e.message;return;}
    busy=true;error.hidden=true;const controls=[...form.querySelectorAll('input,textarea,button')];controls.forEach(c=>c.disabled=true);save.textContent='儲存中…';
    try { const result=await correctMatchClock({match,context,seconds:value(),reason:reason.value.trim()}); if(!active)return; busy=false;close();toast('比賽時間已修改');await onSaved?.(result); }
    catch(e){if(active){error.hidden=false;error.textContent=explain(e,'時間修改失敗，請再試一次');}}
    finally { busy=false;controls.forEach(c=>c.disabled=false);save.textContent='儲存時間'; }
  });
  document.addEventListener('keydown',key);dlg.addEventListener('click',e=>{if(e.target===dlg)close();});document.body.append(dlg);minutes.focus();return close;
}
