import { validateTeamPlayers, MAX_PLAYERS_PER_ADD } from '../../js/engine/team-player-add.js';
const options = { division: { eligibility:{bornOnOrAfter:'2016-01-01'} }, asOf:'2026-10-09' };
const validate = (rows, extra={}) => validateTeamPlayers(rows,{...options,...extra});

test('ADD-OPTIONAL 只填姓名可儲存，空背號不變成 0，不虛構身分資料',()=>{
  const result = validate([{name:' 小飛 '},{name:'小球',jerseyNo:'',birthDate:'',idLast4:''}]);
  expect(result.errors).toEqual([]);
  expect(result.players).toEqual(['小飛','小球'].map(name=>({name,jerseyNo:null,birthDate:'',idLast4:'',identityComplete:false,
    nameKind:'real',kind:'player',role:'player',status:'approved',isCaptain:false,isGoalkeeper:false})));
});
test('完整資料保留開頭 0，背號 0 有效，未成年暱稱與成人姓名沿用隱私規則',()=>{
  const result=validate([{name:'小飛',jerseyNo:'0',birthDate:'2020-02-29',idLast4:'0012',isGoalkeeper:true,isCaptain:true}]);
  expect(result.errors).toEqual([]); expect(result.players[0]).toMatchObject({jerseyNo:0,idLast4:'0012',identityComplete:true,nameKind:'nickname',isGoalkeeper:true,isCaptain:true});
  expect(validate([{name:'成人',birthDate:'1990-01-01'}],{division:{}}).players[0].nameKind).toBe('real');
});
test.each([undefined,[],{},Array.from({length:MAX_PLAYERS_PER_ADD+1},()=>({name:'球員'}))].map(rows=>[rows]))('批次至少一位、最多 50 位：%j',rows=>{
  expect(validate(rows).errors.length).toBeGreaterThan(0);
});
test.each([{name:''},{name:' '},{name:'a'.repeat(41)},{name:'小\n飛'},{name:123},{name:'小飛',jerseyNo:'1.2'},
  {name:'小飛',jerseyNo:1000},{name:'小飛',birthDate:'2020-02-30'},{name:'小飛',birthDate:'2000-01-01'},
  {name:'小飛',idLast4:'012'},{name:'小飛',idLast4:1234},{name:'小飛',isCaptain:'true'},null])('填寫的資料仍須有效：%j',row=>{
  expect(validate([row]).errors.length).toBeGreaterThan(0);
});
test('同批與現有球員的姓名、背號、場上隊長不能重複；留白與移除紀錄不佔背號',()=>{
  expect(validate([{name:'Player'},{name:' ＰＬＡＹＥＲ '}]).errors.join()).toContain('相同姓名');
  expect(validate([{name:'甲',jerseyNo:0},{name:'乙',jerseyNo:'0'}]).errors.join()).toContain('0 號');
  const existingMembers=[{name:'甲',status:'approved',kind:'player',jerseyNo:7,isCaptain:true},{name:'乙',status:'pending',kind:'player',jerseyNo:8}];
  expect(validate([{name:'甲'}],{existingMembers}).errors.join()).toContain('相同姓名');
  expect(validate([{name:'新',jerseyNo:8}],{existingMembers}).errors.join()).toContain('8 號');
  expect(validate([{name:'新',isCaptain:true}],{existingMembers}).errors.join()).toContain('場上隊長');
  expect(validate([{name:'新',jerseyNo:7}],{existingMembers:[{name:'舊',jerseyNo:7,status:'removed'}]}).errors).toEqual([]);
});
test('客戶端不能透過新增資料指派身分、狀態、來源或公開姓名',()=>{
  const result=validate([{name:'小飛',source:'admin',role:'super_admin',status:'rejected',nameKind:'nickname',displayName:'任意公開名'}]);
  expect(result.players[0]).toMatchObject({status:'approved',role:'player',nameKind:'real'});
  expect(result.players[0]).not.toHaveProperty('source'); expect(result.players[0]).not.toHaveProperty('displayName');
});
