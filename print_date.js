const { parseISO, format, addDays } = require('date-fns');

const start = parseISO('2026-03-24');
const from = parseISO('2026-03-24');

let cursor = new Date(Math.max(from.getTime(), start.getTime()));

console.log('cursor date:', format(cursor, 'yyyy-MM-dd'));
console.log('dayNum:', Math.floor((cursor.getTime() - start.getTime()) / 86400000) + 1);

const dayNum = Math.floor((cursor.getTime() - start.getTime()) / 86400000) + 1;
if (dayNum < 1) console.log("SKIPPED because < 1");
else console.log("GENERATED");

