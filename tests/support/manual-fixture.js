import { FORMATS } from '../../js/engine/formats.js';
import { createManualDraft, manualMatchesOf } from '../../js/engine/manual-schedule.js';
import { planGeneration, matchDocOf } from '../../js/engine/schedule-doc.js';
import { taipeiMs } from '../../js/engine/schedule.js';

export const division={divisionId:'d',name:'測試組',code:'TT',date:'2026-10-09',formatId:'F4_RR_FINAL',
  rankingRuleId:'RR_FEDA_DEFAULT',matchDurationMin:30,playersOnField:9,scheduleRevision:0,schedulePublished:false};
export const teams=['t1','t2','t3','t4'].map((teamId,i)=>({teamId,divisionId:'d',name:`球隊${i+1}`,shortName:`隊${i+1}`,status:'approved',withdrawn:false}));
export const format=FORMATS.F4_RR_FINAL;
export const venues=[{venueId:'v',name:'主場',fieldType:'9v9'},{venueId:'small',name:'小場',fieldType:'5v5'}];
export const cfg={startTime:'08:30',endTime:'18:00',minRestMin:20,maxGapMin:240,venuesByDate:{'2026-10-09':['v']}};
export const context={division,teams,format,venues,cfg,divisions:[division],allMatches:[]};
export function filledDraft(extra={}){
  const spec={...context,...extra},draft=createManualDraft(spec);
  if(draft.mode==='create'){
    const plan=planGeneration({division:spec.division,orderedTeams:draft.orderedTeamIds.map(id=>spec.teams.find(t=>t.teamId===id)),format:spec.format});
    draft.matches.forEach((m,i)=>{
      const ref=plan.matches.find(p=>p.matchId===m.matchId);
      if(m.isRoundRobin){m.homeTeamId=ref.home.teamId;m.awayTeamId=ref.away.teamId;}
      m.kickoffAt=taipeiMs(spec.division.date,'08:30')+i*40*60000;m.venueId='v';
    });
  }
  return draft;
}
export function existingDocs(draft=filledDraft()) {
  return manualMatchesOf({draft,division,teams}).map(m=>({...matchDocOf({m:{...m,kickoffMs:m.kickoffAt},division,eventId:'manual-test'}),kickoffAt:m.kickoffAt,venueName:'主場'}));
}
