const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const solverMatch = html.match(/function advanceFloodSimulation\\(\\)\\{[\\s\\S]*?\\n\\}\\nfunction drawWater\\(\\)/);
assert.ok(solverMatch, 'advanceFloodSimulation must exist');
const solverSource = solverMatch[0].replace(/\\nfunction drawWater\\(\\)$/, '');

function makeSimulation(options = {}) {
  const width = 3;
  const height = 3;
  const grid = new Float32Array(width * height);
  const waterDepth = new Float32Array(width * height);
  const flowDelta = new Float32Array(width * height);
  const sourceCells = new Set(options.sourceCells ?? []);
  const wetCells = new Set(options.wetCells ?? [4]);
  for (const [index, depth] of Object.entries(options.initialDepths ?? { 4: 1 })) {
    waterDepth[Number(index)] = depth;
  }
  const blockedCells = new Set(options.blockedCells ?? []);
  const polderCells = new Set();
  const floodActiveBuffer = [];
  const floodTouchedBuffer = [];
  const context = {
    simulationReady: true,
    waterDepth,
    flowDelta,
    geoImage: { getWidth: () => width, getHeight: () => height },
    breachClosed: options.breachClosed ?? true,
    sourceCells,
    level: options.level ?? 1,
    seconds: options.seconds ?? 0,
    pumpUntil: options.pumpUntil ?? -1,
    wetCells,
    floodActiveBuffer,
    floodTouchedBuffer,
    grid,
    blockedCells,
    polderCells,
    validTerrainHeight: value => Number.isFinite(value) && value < 1e20
  };
  const advance = vm.runInNewContext(solverSource + '; advanceFloodSimulation', context);
  advance();
  return { waterDepth, flowDelta, wetCells, context };
}

test('water is conserved by the flow solver (within Float32 precision)', () => {
  const sim = makeSimulation();
  const total = [...sim.waterDepth].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-5, 'water volume must remain stable');
  assert.ok([...sim.waterDepth].every(Number.isFinite));
  assert.ok([...sim.waterDepth].every(value => value >= 0));
  assert.ok([...sim.flowDelta].every(value => value === 0), 'flow deltas must be cleared');
  assert.ok(sim.wetCells.size > 1, 'water must spread to adjacent cells');
});

test('blocked cells stop flow across a dam', () => {
  const sim = makeSimulation({ blockedCells: [1, 3, 5, 7] });
  assert.equal(sim.wetCells.size, 1);
  assert.ok(Math.abs(sim.waterDepth[4] - 1) < 1e-6);
  assert.ok([...sim.waterDepth].every((value, index) => index === 4 || value === 0));
});

test('pump removes water from land without creating negative depth', () => {
  const sim = makeSimulation({
    initialDepths: { 4: 0.5 },
    sourceCells: [],
    breachClosed: true,
    seconds: 1,
    pumpUntil: 10
  });
  const total = [...sim.waterDepth].reduce((sum, value) => sum + value, 0);
  assert.ok(total < 0.5 && total > 0.49);
  assert.ok([...sim.waterDepth].every(value => value >= 0));
});

test('closing the breach stops replenishment from the source', () => {
  const sim = makeSimulation({
    initialDepths: { 4: 0.2 },
    sourceCells: [4],
    breachClosed: true,
    level: 1
  });
  const total = [...sim.waterDepth].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 0.2) < 1e-5);
});

test('an open breach replenishes water from the boundary level', () => {
  const sim = makeSimulation({
    initialDepths: { 4: 0.2 },
    sourceCells: [4],
    breachClosed: false,
    level: 1
  });
  const total = [...sim.waterDepth].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-5);
});

test('the inline browser script parses and every referenced UI id exists', () => {
  const scripts = [...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)]
    .map(match => match[1]).filter(script => script.trim());
  assert.ok(scripts.length > 0);
  for (const script of scripts) new vm.Script(script);

  const ids = new Set([...html.matchAll(/\\bid=["']([^"']+)["']/g)].map(match => match[1]));
  const references = new Set([...html.matchAll(/\\$\\(["']([^"']+)["']\\)/g)].map(match => match[1]));
  for (const id of references) assert.ok(ids.has(id), 'missing UI element: ' + id);
});
