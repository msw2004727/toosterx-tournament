import { computeScorers } from '../../js/engine/awards.js';
import { hiddenScorerDivisions } from '../../js/modules/public/selectors.js';
import { buildSeed } from '../../scripts/seed/build.js';
const events=[{type:'goal',playerId:'p',matchId:'m',teamId:'t',periodId:'h1'}];
test('disabled scorer statistics skip goals while other divisions retain goals',()=>{
 expect(computeScorers(events,{enabled:false})).toEqual([]);
 expect(computeScorers(events,{enabled:true})[0].goals).toBe(1);
});
test('all three youth groups cannot be exposed by the global display flag',()=>{
 const divisions=buildSeed().docs.filter(d=>d.path.includes('/divisions/')&&d.path.split('/').length===4).map(d=>d.data);
 expect([...hiddenScorerDivisions(divisions,{youthScorerBoard:true})].sort()).toEqual(['u10','u6','u8']);
});
