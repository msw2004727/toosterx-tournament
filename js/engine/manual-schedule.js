/** 私有手動草稿與發布檢查。前端預覽及後端交易共用；不碰存取與時鐘。 */
import { planGeneration } from './schedule-doc.js';
import { checkSchedule, kickoffMsOf, taipeiMs, teamRefOf, SCHEDULE_DEFAULTS } from './schedule.js';

const canonical = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const pairKey = (a, b) => [a, b].sort().join('|');
const groupKey = m => `${m.stageId}|${m.groupId}`;

/** 分數曾經存在、換狀態或期別也不能繞過鎖定。 */
export function manualMatchLocked(m) {
  return !['scheduled', 'checkin', 'ready', 'postponed', 'cancelled'].includes(m?.status ?? 'scheduled')
    || !!m?.result?.winner || (m?.revisionCount ?? 0) > 0 || m?.lock?.locked === true
    || (m?.period != null && m.period !== 'pre')
    || (typeof m?.score?.home === 'number' && m.score.home > 0)
    || (typeof m?.score?.away === 'number' && m.score.away > 0);
}

function approvedOf(teams, divisionId) {
  return teams.filter(t => t.divisionId === divisionId && t.status === 'approved' && t.withdrawn !== true);
}

export function manualSourceBasis({ division, teams, format, existingMatches = [] }) {
  return canonical({ division: { divisionId: division.divisionId, date: division.date ?? null,
    code: division.code ?? null, formatId: division.formatId ?? null, rankingRuleId: division.rankingRuleId ?? null,
    matchDurationMin: division.matchDurationMin ?? null, playersOnField: division.playersOnField ?? null }, format,
    teams: approvedOf(teams, division.divisionId).map(t => ({ teamId: t.teamId, seed: t.seed ?? null, groupId: t.groupId ?? null })).sort((a,b) => a.teamId.localeCompare(b.teamId)),
    matches: existingMatches.map(m => ({ matchId: m.matchId, stageId: m.stageId, groupId: m.groupId ?? null,
      round: m.round ?? null, matchKey: m.matchKey ?? null, home: m.home?.teamId ?? null, away: m.away?.teamId ?? null,
      kickoffAt: kickoffMsOf(m), venueId: m.venueId ?? null, status: m.status ?? null, period: m.period ?? null,
      score: m.score ?? null, result: m.result ?? null, locked: m.lock?.locked === true,
      revisionCount: m.revisionCount ?? 0, managementRevision: m.managementRevision ?? 0 })).sort((a,b) => a.matchId.localeCompare(b.matchId)) });
}

export function createManualDraft({ division, teams = [], format, existingMatches = [], generated = false, groupCount = null, orderedTeamIds = null }) {
  const approved = approvedOf(teams, division.divisionId);
  const original = existingMatches.filter(m => m.divisionId === division.divisionId);
  const isEdit = original.length > 0;
  const hasSeeds=approved.every(t=>Number.isInteger(t.seed));
  const ordered = orderedTeamIds && !isEdit ? orderedTeamIds.map(id=>approved.find(t=>t.teamId===id))
    : [...approved].sort((a,b) => hasSeeds ? a.seed-b.seed || a.teamId.localeCompare(b.teamId) : a.teamId.localeCompare(b.teamId));
  if(ordered.length!==approved.length||ordered.some(t=>!t)||new Set(ordered.map(t=>t.teamId)).size!==approved.length)
    throw new Error('核准球隊名單與分組順序不一致');
  const plan = planGeneration({ division, orderedTeams: ordered, format });
  const stages = Object.fromEntries(format.stages.map(s => [s.stageId,s]));
  const structureLocked = original.some(manualMatchLocked);
  const source = isEdit ? original : plan.matches;
  const matches = source.map(m => {
    const isRoundRobin = stages[m.stageId]?.type === 'roundRobin';
    const reference = !isRoundRobin ? plan.matches.find(p => p.stageId === m.stageId && p.matchKey === m.matchKey) : null;
    const homeTeamId = isEdit ? m.home?.teamId ?? null : null;
    const awayTeamId = isEdit ? m.away?.teamId ?? null : null;
    const kickoffAt = isEdit ? kickoffMsOf(m) : null;
    const venueId = isEdit ? m.venueId ?? null : null;
    return { matchId: m.matchId, divisionId: division.divisionId, stageId: m.stageId, groupId: m.groupId ?? null,
      matchKey: m.matchKey ?? null, round: m.round, label: m.label ?? m.matchId, matchNo: m.matchNo ?? null,
      isRoundRobin, locked: isEdit && manualMatchLocked(m),
      homeTeamId, awayTeamId, home: m.home ?? null, away: m.away ?? null,
      sourceHome: reference?.home ?? null, sourceAway: reference?.away ?? null, kickoffAt, venueId,
      baseline: { homeTeamId, awayTeamId, kickoffAt, venueId } };
  });
  const groups = plan.groupDocs.map(g => ({ stageId:g.stageId, groupId:g.groupId, teamIds:[...g.teamIds] }));
  const teamRequirements = groups.flatMap(g => g.teamIds.map(teamId => ({ teamId, stageId:g.stageId,
    groupId:g.groupId, matchCount:plan.matches.filter(m => m.stageId === g.stageId && m.groupId === g.groupId && m.teamIds.includes(teamId)).length })));
  const expectedCounts = {};
  for (const m of plan.matches) expectedCounts[groupKey(m)] = (expectedCounts[groupKey(m)] ?? 0)+1;
  const expectedPairs={};
  for(const m of plan.matches.filter(m=>stages[m.stageId]?.type==='roundRobin')) {
    const key=`${groupKey(m)}|${pairKey(m.home.teamId,m.away.teamId)}`;
    expectedPairs[key]=(expectedPairs[key]??0)+1;
  }
  return { schemaVersion:1, mode:isEdit?'edit':'create', divisionId:division.divisionId,
    expectedRevision:division.scheduleRevision ?? 0, orderedTeamIds:ordered.map(t=>t.teamId), formatId:format.formatId,
    generated, groupCount, structureLocked, groups, teamRequirements, expectedCounts, expectedPairs,
    expectedSlots:plan.matches.filter(m=>m.matchKey).map(m=>({stageId:m.stageId,matchKey:m.matchKey})),
    sourceBasis:manualSourceBasis({division,teams,format,existingMatches:original}), matches };
}

/** 只由可編輯的四個欄位組合預覽，晉級來源始終沿用範本。 */
export function manualMatchesOf({ draft, division, teams = [] }) {
  const byId=Object.fromEntries(teams.map(t=>[t.teamId,t]));
  return draft.matches.map(m => ({ matchId:m.matchId,divisionId:division.divisionId,stageId:m.stageId,
    groupId:m.groupId,matchKey:m.matchKey,round:m.round,label:m.label,matchNo:m.matchNo,
    kickoffAt:m.kickoffAt,venueId:m.venueId,
    home:m.isRoundRobin?teamRefOf(byId[m.homeTeamId]):{...m.home,placeholder:m.sourceHome?.placeholder??m.home?.placeholder??null},
    away:m.isRoundRobin?teamRefOf(byId[m.awayTeamId]):{...m.away,placeholder:m.sourceAway?.placeholder??m.away?.placeholder??null},
    teamIds:[m.homeTeamId,m.awayTeamId].filter(Boolean) }));
}

export function getManualFindings({ draft, division, teams = [], venues = [], allMatches = [], divisions = [], cfg }) {
  const findings=[];
  const add=(code,message,matchIds=[])=>findings.push({level:'error',code,message,matchIds,source:'手動賽程'});
  const groups=Object.fromEntries(draft.groups.map(g=>[groupKey(g),g]));
  const approved=new Set(approvedOf(teams,division.divisionId).map(t=>t.teamId));
  const teamNames=Object.fromEntries(teams.map(t=>[t.teamId,t.shortName||t.name||t.teamId]));
  const counts={},pairs={},ids=new Set(),slots=new Set();
  const config={...SCHEDULE_DEFAULTS,...(cfg??{})};
  const dayStart=taipeiMs(division.date,config.startTime),dayEnd=taipeiMs(division.date,config.endTime);
  if(dayStart==null||dayEnd==null||dayEnd<=dayStart||!Number.isFinite(division.matchDurationMin)||division.matchDurationMin<=0)
    add('MANUAL_CONFIG','缺少有效的比賽日期、營運時間或比賽長度，請先完成組別與排程設定');
  for(const m of draft.matches){
    if(ids.has(m.matchId))add('DUPLICATE_MATCH','場次代碼重複',[m.matchId]);ids.add(m.matchId);
    const key=groupKey(m);counts[key]=(counts[key]??0)+1;
    if(m.matchKey)slots.add(`${m.stageId}|${m.matchKey}`);
    const base=m.baseline;
    if(m.locked&&(!base||m.homeTeamId!==base.homeTeamId||m.awayTeamId!==base.awayTeamId||m.kickoffAt!==base.kickoffAt||m.venueId!==base.venueId))
      add('STARTED_LOCK',`${m.label} 已開打或有結果，不能修改`,[m.matchId]);
    if(draft.structureLocked&&m.isRoundRobin&&(m.homeTeamId!==base?.homeTeamId||m.awayTeamId!==base?.awayTeamId))
      add('STRUCTURE_LOCK','此組別已有場次開打，不能改變對戰球隊',[m.matchId]);
    if(m.isRoundRobin){
      if(!m.homeTeamId||!m.awayTeamId)add('MISSING_TEAM',`${m.label} 尚未安排主隊及客隊`,[m.matchId]);
      else if(m.homeTeamId===m.awayTeamId)add('SELF_MATCH',`${m.label} 不可同隊對自己`,[m.matchId]);
      else if(!groups[key]||[m.homeTeamId,m.awayTeamId].some(id=>!approved.has(id)||!groups[key].teamIds.includes(id)))
        add('WRONG_GROUP',`${m.label} 只能安排同小組的核准球隊`,[m.matchId]);
      else {const p=`${key}|${pairKey(m.homeTeamId,m.awayTeamId)}`;pairs[p]=(pairs[p]??0)+1;}
    }else if(m.homeTeamId!==base?.homeTeamId||m.awayTeamId!==base?.awayTeamId)
      add('SOURCE_FIXED',`${m.label} 的隊伍由晉級來源決定，不能手動更換`,[m.matchId]);
    const start=m.kickoffAt;
    if(start!=null&&(!Number.isSafeInteger(start)||start<dayStart||start+division.matchDurationMin*60000>dayEnd))
      add('OUTSIDE_WINDOW',`${m.label} 必須排在比賽日 ${config.startTime}–${config.endTime} 內`,[m.matchId]);
    const allowed=config.venuesByDate?.[division.date];
    if(m.venueId&&Array.isArray(allowed)&&allowed.length&&!allowed.includes(m.venueId))
      add('VENUE_DATE',`${m.label} 的場地當日未開放`,[m.matchId]);
  }
  if(canonical(counts)!==canonical(draft.expectedCounts)||slots.size!==draft.expectedSlots.length||draft.expectedSlots.some(s=>!slots.has(`${s.stageId}|${s.matchKey}`)))
    add('SCHEDULE_STRUCTURE','場次或晉級位置與賽制範本不一致，請重新產生完整草稿');
  for(const g of draft.groups){
    for(let i=0;i<g.teamIds.length;i++)for(let j=i+1;j<g.teamIds.length;j++){
      const count=pairs[`${groupKey(g)}|${pairKey(g.teamIds[i],g.teamIds[j])}`]??0;
      const required=draft.expectedPairs[`${groupKey(g)}|${pairKey(g.teamIds[i],g.teamIds[j])}`]??0;
      if(count!==required)add('PAIR_COVERAGE',`${g.groupId}組對戰不完整或重複：${teamNames[g.teamIds[i]]??g.teamIds[i]}／${teamNames[g.teamIds[j]]??g.teamIds[j]} 需 ${required} 場，目前 ${count} 場`);
    }
  }
  const preview=manualMatchesOf({draft,division,teams});
  // 其他組別未完成的草稿不阻擋本組，但每一場已排定的比賽皆參與跨組撞場檢查。
  const other=allMatches.filter(m=>m.divisionId!==division.divisionId&&kickoffMsOf(m)!=null&&m.venueId);
  const mergedDivisions=[...divisions.filter(d=>d.divisionId!==division.divisionId),division];
  findings.push(...checkSchedule({matches:[...other,...preview],venues,divisions:mergedDivisions,minRestMin:config.minRestMin,maxGapMin:config.maxGapMin}).findings);
  return findings;
}

/** 發布 API 的白名單，永遠不接受前端提供比分、名稱或晉級規則。 */
export function manualPayloadOf(draft) {
  return {schemaVersion:1,mode:draft.mode,divisionId:draft.divisionId,expectedRevision:draft.expectedRevision,
    orderedTeamIds:[...draft.orderedTeamIds],formatId:draft.formatId,generated:draft.generated===true,groupCount:draft.groupCount??null,
    sourceBasis:draft.sourceBasis,matches:draft.matches.map(m=>({matchId:m.matchId,homeTeamId:m.homeTeamId??null,
      awayTeamId:m.awayTeamId??null,kickoffAt:m.kickoffAt??null,venueId:m.venueId??null}))};
}
