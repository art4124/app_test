import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../vune-runtime.js', import.meta.url), 'utf8');
const names = ['getEntryDates','getPeriodStarts','average','getCycleLengths','getPrediction'];
const definitions = names.map(name => {
  const line = source.split('\n').find(item => item.startsWith(`function ${name}(`));
  assert.ok(line, `Missing ${name}`);
  assert.equal(new RegExp(`\\b${name}\\s*=\\s*function\\b`).test(source), false, `${name} has a later replacement`);
  return line;
}).join('\n');
const state = {entries:{'2026-01-01':{period:true},'2026-01-02':{period:true},'2026-01-11':{period:true},'2026-03-22':{period:true}}};
const context = {
  state,
  addDays(date, days){const result=new Date(date+'T00:00:00Z');result.setUTCDate(result.getUTCDate()+days);return result.toISOString().slice(0,10);},
  diffDays(a,b){return Math.round((Date.parse(b)-Date.parse(a))/86400000);}
};
vm.createContext(context);
vm.runInContext(definitions, context);
assert.deepEqual(Array.from(context.getCycleLengths(), cycle => cycle.days), [10,70]);
assert.equal(context.getPrediction(), null, 'Do not present a default forecast when all recorded cycles are irregular');
state.entries['2026-04-21']={period:true};
assert.equal(context.getPrediction().average, 30);
assert.equal(context.getPrediction().confidence, 'Variable');
console.log('Final cycle calculations passed.');
