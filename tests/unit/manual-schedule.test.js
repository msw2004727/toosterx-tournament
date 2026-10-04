import { createManualDraft, getManualFindings, manualMatchesOf, manualPayloadOf, manualMatchLocked } from '../../js/engine/manual-schedule.js';
import { context,division,teams,filledDraft,existingDocs,cfg,venues,format } from '../support/manual-fixture.js';
import { FORMATS } from '../../js/engine/formats.js';

const errors=draft=>getManualFindings({...context,draft}).filter(f=>f.level==='error');
test('新建草稿 RR 空白、晉級來源固定並顯示每隊應有場數',()=>{
  const d=createManualDraft(context);
  expect(d.matches.filter(m=>m.isRoundRobin).every(m=>m.homeTeamId===null&&m.awayTeamId===null)).toBe(true);
  expect(d.matches.filter(m=>!m.isRoundRobin).every(m=>m.sourceHome.placeholder&&m.sourceAway.placeholder)).toBe(true);
  expect(d.teamRequirements.every(r=>r.matchCount===3)).toBe(true);expect(d.groups[0].teamIds).toEqual(['t1','t2','t3','t4']);
  expect(errors(d).map(f=>f.code)).toEqual(expect.arrayContaining(['MISSING_TEAM','PAIR_COVERAGE','NO_SLOT']));
});
test('完整賽制手動對戰可發布，休息不足只警告',()=>{
  const f=getManualFindings({...context,draft:filledDraft()});expect(f.filter(f=>f.level==='error')).toEqual([]);expect(f.some(f=>f.code==='SHORT_REST'&&f.level==='warn')).toBe(true);
});
test('同一隊不可自賽，重複對戰與漏排不能互相抵銷',()=>{
  const d=filledDraft();d.matches[0].awayTeamId=d.matches[0].homeTeamId;expect(errors(d).some(f=>f.code==='SELF_MATCH')).toBe(true);
  const e=filledDraft();e.matches[1].homeTeamId=e.matches[0].homeTeamId;e.matches[1].awayTeamId=e.matches[0].awayTeamId;
  expect(errors(e).some(f=>f.code==='PAIR_COVERAGE')).toBe(true);
});
test('錯小組、退賽及非核准隊伍禁止安排',()=>{
  const d=filledDraft();d.matches[0].homeTeamId='outsider';expect(errors(d).some(f=>f.code==='WRONG_GROUP')).toBe(true);
  const f=getManualFindings({...context,draft:filledDraft(),teams:teams.map(t=>({...t,withdrawn:t.teamId==='t1'}))});expect(f.some(f=>f.code==='WRONG_GROUP')).toBe(true);
});
test('移除場次、重複 ID、修改 KO 隊伍會擋發布',()=>{
  const d=filledDraft();d.matches.pop();expect(errors(d).some(f=>f.code==='SCHEDULE_STRUCTURE')).toBe(true);
  const e=filledDraft();e.matches[1].matchId=e.matches[0].matchId;expect(errors(e).some(f=>f.code==='DUPLICATE_MATCH')).toBe(true);
  const f=filledDraft();f.matches.find(m=>!m.isRoundRobin).homeTeamId='t1';expect(errors(f).some(f=>f.code==='SOURCE_FIXED')).toBe(true);
});
test('超出日期與營運時間、當日不可用／大小錯誤場地均拒絕',()=>{
  const d=filledDraft();d.matches[0].kickoffAt-=86400000;expect(errors(d).some(f=>f.code==='OUTSIDE_WINDOW')).toBe(true);
  const e=filledDraft();e.matches[0].venueId='small';const f=errors(e).map(f=>f.code);expect(f).toEqual(expect.arrayContaining(['VENUE_DATE','FIELD_TOO_SMALL']));
});
test('保留既有非5分鐘時間，沒有擅自取整',()=>{
  const d=filledDraft();d.matches[0].kickoffAt+=2*60000;expect(errors(d)).toEqual([]);expect(manualPayloadOf(d).matches[0].kickoffAt).toBe(d.matches[0].kickoffAt);
});
test('其他組別未排定的不阻擋，本組與其他組同場同時仍拒絕',()=>{
  const d=filledDraft(),m=manualMatchesOf({draft:d,division,teams})[0];
  expect(getManualFindings({...context,draft:d,allMatches:[{...m,matchId:'empty',divisionId:'other',kickoffAt:null}]}).filter(f=>f.level==='error')).toEqual([]);
  const f=getManualFindings({...context,draft:d,allMatches:[{...m,matchId:'collision',divisionId:'other',teamIds:[]}],divisions:[division,{...division,divisionId:'other'}]});
  expect(f.some(f=>f.code==='VENUE_OVERLAP')).toBe(true);
});
test.each([{status:'live'},{status:'confirmed'},{status:'cancelled',result:{winner:'home'}},{lock:{locked:true}},{score:{home:1,away:0}},{period:'h1'},{revisionCount:1}])('開打護欄辨識 %j',patch=>{
  expect(manualMatchLocked({status:'scheduled',period:'pre',score:{home:0,away:0},...patch})).toBe(true);
});
test('既有有結果鎖住整組隊伍結構，未開打場次仍可改時間',()=>{
  const old=existingDocs();old[0].status='finished';const d=createManualDraft({...context,existingMatches:old});
  expect(d.structureLocked).toBe(true);expect(d.matches[0].locked).toBe(true);
  d.matches[0].kickoffAt+=60000;expect(errors(d).some(f=>f.code==='STARTED_LOCK')).toBe(true);
  const e=createManualDraft({...context,existingMatches:old});e.matches[1].kickoffAt+=60000;expect(errors(e)).toEqual([]);
  e.matches[1].homeTeamId='t4';expect(errors(e).some(f=>f.code==='STRUCTURE_LOCK')).toBe(true);
});
test('名稱、比分、晉級或任意 metadata 不進發布 payload',()=>{
  const d=filledDraft();d.matches[0].score={home:99};d.matches[0].home.name='<img>';const p=manualPayloadOf(d);
  expect(Object.keys(p.matches[0]).sort()).toEqual(['awayTeamId','homeTeamId','kickoffAt','matchId','venueId']);
  expect(JSON.stringify(p.matches)).not.toContain('<img>');expect(JSON.stringify(p.matches)).not.toContain('score');
});
test('來源版本涵蓋分組、賽制與已存在比分，以便伺服器偵測改動',()=>{
  const old=existingDocs(),d=createManualDraft({...context,existingMatches:old});old[0].score.home=1;
  expect(createManualDraft({...context,existingMatches:old}).sourceBasis).not.toBe(d.sourceBasis);
  expect(createManualDraft({...context,existingMatches:existingDocs(),format:{...format,name:'已變更賽制'}}).sourceBasis).not.toBe(d.sourceBasis);
});
test('既有場次不套用尚未發布的另一份分組顺序',()=>{
  const old=existingDocs(),d=createManualDraft({...context,existingMatches:old,orderedTeamIds:['t4','t3','t2','t1']});
  expect(d.orderedTeamIds).toEqual(['t1','t2','t3','t4']);expect(errors(d)).toEqual([]);
});
test('八隊二小組的20場完整草稿，跨小組拖入球隊会被檢查擋下',()=>{
  const allTeams=Array.from({length:8},(_,i)=>({...teams[0],teamId:`t${i+1}`,name:`隊${i+1}`}));
  const d=filledDraft({teams:allTeams,format:FORMATS.F8_GROUP_CROSS,division:{...division,formatId:'F8_GROUP_CROSS'}});
  expect(d.matches).toHaveLength(20);expect(d.groups).toHaveLength(2);expect(d.teamRequirements.every(r=>r.matchCount===3)).toBe(true);
  const a=d.matches.find(m=>m.isRoundRobin&&m.groupId==='A');a.homeTeamId=d.groups.find(g=>g.groupId==='B').teamIds[0];
  expect(getManualFindings({...context,teams:allTeams,draft:d}).some(f=>f.code==='WRONG_GROUP')).toBe(true);
});
