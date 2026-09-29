import fs from 'node:fs';
import { divisionThemeAttrs, setDivisionTheme } from '../../js/core/division-theme.js';
import { DIVISIONS } from '../../js/engine/formats.js';

test('六組從共用設定取得色彩，已知組別不接受覆蓋固定色', () => {
  for (const d of DIVISIONS) {
    expect(divisionThemeAttrs(d.divisionId)).toEqual({ 'data-division': d.divisionId, 'data-division-tone': d.colorToken });
    expect(divisionThemeAttrs({ ...d, colorToken:'div-open' })['data-division-tone']).toBe(d.colorToken);
  }
});
test('未知組別與不可信 token 保持中性', () => {
  expect(divisionThemeAttrs(null)).toEqual({});
  expect(divisionThemeAttrs('unconfigured')).toEqual({});
  expect(divisionThemeAttrs({ divisionId:'new',colorToken:'url(https://invalid)' })).toEqual({});
});
test('返回全部組別時清除前一組識別', () => {
  const attrs=new Map();
  const node={setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
  setDivisionTheme(node,'women');
  expect(attrs.get('data-division-tone')).toBe('div-women');
  setDivisionTheme(node,null);
  expect(attrs.size).toBe(0);
});
test('固定的六組色碼在深淺主題完全一致', () => {
  const css=fs.readFileSync('css/tokens.css','utf8');
  const palette={u6:'#D95F3F',u8:'#C08A22',u10:'#3F8C55',women:'#9C4F91',fun:'#3A7CAE',open:'#245079'};
  for(const [key,value] of Object.entries(palette)) expect([...css.matchAll(new RegExp(`--div-${key}:(${value})`, 'g'))]).toHaveLength(2);
});
