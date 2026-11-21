'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { boot, cast, newMatch, makeCtx, GAME } = require('./harness');
const KEYS = ['valor', 'grim', 'astra', 'vesper', 'rook'];
const EXPECTED = { astra: 55, grim: 57, valor: 55, vesper: 59, rook: 64 };
async function main() {
  const h = boot({ render: true, record: true });
  h.g.Sprites.load(); h.g.Sprites.loadItems();
  await h.settle(20);
  for (const key of KEYS) {
    const meta = JSON.parse(fs.readFileSync(path.join(GAME, 'assets/atlas', `${key}.json`)));
    assert.strictEqual(meta.sourceFrames.length, EXPECTED[key], `${key}: wrong frame count`);
    const referenced = new Set();
    for (const row of Object.values(meta.anims)) for (const entry of row) {
      referenced.add(entry[0]); for (const effect of entry[3] || []) referenced.add(effect[0]);
    }
    for (const frame of meta.sourceFrames) {
      assert(referenced.has(frame.tile), `${key}: row ${frame.row}, column ${frame.column} is unused`);
      const f = `${String(frame.row).padStart(2,'0')}-${String(frame.column).padStart(2,'0')}.png`;
      assert(fs.existsSync(path.join(GAME,'assets/frames',key,f)), `${key}: missing ${f}`);
    }
    assert(h.g.Sprites.ready(key), `${key}: atlas failed to load`);
    assert(h.g.Sprites.LEDGE_ART[key], `${key}: approved ledge pose did not load`);
    const ledgeMeta = h.g.Sprites.LEDGE_ART[key];
    assert(ledgeMeta.anchor.handX >= 0 && ledgeMeta.anchor.handX < ledgeMeta.img.width && ledgeMeta.anchor.handY >= 0 && ledgeMeta.anchor.handY < ledgeMeta.img.height, `${key}: invalid hand anchor`);
    const match = newMatch(h.ctx, cast(2, [key, 'grim']));
    const f = match.fighters[0];
    const rec = { ops: [] }, ctx = makeCtx(rec);
    assert(h.g.Sprites.drawSpriteFighter(ctx, f, 0), `${key}: sprite did not render`);
    assert(rec.ops.some(op => op.op === 'drawImage'), `${key}: no atlas draw`);
    for (const side of [-1, 1]) {
      const edge = side < 0 ? match.stage.ground.x : match.stage.ground.x + match.stage.ground.w;
      f.snapLedge(match, side, edge);
      const hangRec = { ops: [] }, hangCtx = makeCtx(hangRec);
      assert(h.g.Sprites.drawSpriteFighter(hangCtx, f, 0), `${key}: ledge pose did not render`);
      const draw = hangRec.ops.find(op => op.op === 'drawImage');
      assert(draw && draw.img === ledgeMeta.img, `${key}: ledge pose was not used`);
      assert.strictEqual(Math.sign(draw.matrix[0]), -side, `${key}: ledge pose not mirrored correctly`);
      const handX = draw.matrix[0] * (draw.dx + ledgeMeta.anchor.handX) + draw.matrix[4];
      const handY = draw.matrix[3] * (draw.dy + ledgeMeta.anchor.handY) + draw.matrix[5];
      assert(Math.abs(handX - edge) < .01 && Math.abs(handY - match.stage.ground.y) < .01, `${key}: hand not anchored to stage lip`);
    }
    // Real move durations must be long enough to show each assigned frame.
    for (const [move, data] of Object.entries(f.def.moves)) {
      f.state = 'attack'; f.action = { key: move, type: 'move', dur: data.frames,
        startup: data.startup, active: data.active }; f.charging = false;
      const row = meta.anims[h.g.Sprites.MOVE_ANIM[move]];
      const seen = new Set();
      for (let t=0; t<data.frames; t++) {
        f.actionT=t; f.animT=t; seen.add(h.g.Sprites.pickAnim(f,0).i);
      }
      assert.strictEqual(seen.size, row.length, `${key}: ${move} skips a frame at its actual duration`);
    }
    for (const [actionKey, actionType, anim] of [['jab', 'attack', 'jab'], ['n', 'special', 'nspecial'], ['s', 'special', 'sspecial']]) {
      const row = meta.anims[anim];
      f.state = actionType; f.action = actionType === 'attack'
        ? { key: actionKey, type: 'move', dur: 64, startup: 8, active: 4 }
        : { specialKey: actionKey, type: 'special', dur: 64, startup: 8, active: 4 };
      const seen = new Set();
      for (let t=0; t<64; t++) { f.actionT=t; f.animT=t; seen.add(h.g.Sprites.pickAnim(f,0).i); }
      assert.strictEqual(seen.size, row.length, `${key}: ${anim} skips frames`);
    }
  }
  assert(h.g.Sprites.itemArt('beamsword'), 'item artwork failed to load');
  console.log('All 290 source frames are referenced; five atlases, five ledge poses and item art load and render.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
