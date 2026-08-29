// 一次性工具：找出並清掉原始碼中的 NUL 位元組（會讓 git 把檔案當成二進位檔）
const fs = require('fs');
const NUL = String.fromCharCode(0);
for (const f of process.argv.slice(2)) {
  const s = fs.readFileSync(f, 'utf8');
  const i = s.indexOf(NUL);
  if (i < 0) { console.log('OK   ', f); continue; }
  console.log('FOUND', f, '@', i, JSON.stringify(s.slice(i - 70, i + 30)));
  fs.writeFileSync(f, s.split(NUL).join(' '), 'utf8');
  console.log('FIXED', f);
}
