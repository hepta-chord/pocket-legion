// バランス計測の入口。npm run balance で回す。

import { measure } from '../src/sim/autoplay';
import { formatReports } from '../src/sim/report';

const rows = [
  measure('浅層 (2-10)', 2, 300, 11),
  measure('中層 (12-20)', 12, 300, 22),
  measure('深層 (22-30)', 22, 300, 33),
];

console.log(formatReports(rows));
console.log('\n「交代なし」が高すぎるなら物理の配分が過剰、「前衛全滅」が高すぎるなら染めのリスクが強すぎる。');
