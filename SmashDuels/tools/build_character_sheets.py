#!/usr/bin/env python3
"""Build the supplied magenta-backed fighter sheets into individual frames and atlases.

Requires Pillow and NumPy. Run from any directory:
    python tools/build_character_sheets.py

Each row is cut at reviewed, per-sheet seams (not a guessed global grid). The
source rows are retained in order; standalone effects use the last fighter pose
as an underlay. All source cells are included in at least one gameplay animation.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets-src/characters'
OUT = ROOT / 'game/assets'
# Bounds were reviewed against the supplied sheets. A final cell may be wider
# when an effect extends to the edge or the artist leaves unused sheet space.
SPECS = {
 'astra': {'y':[0,160,306,479,639,796,958,1094,1278], 'x':[
  [0,155,310,465,620,775,930,1230],[0,176,337,527,694,861,1039,1230],
  [0,175,346,522,703,859,1026,1230],[0,176,351,522,702,877,1044,1230],
  [0,169,347,523,703,871,1049,1230],[0,176,351,520,703,881,1052,1230],
  [0,176,351,527,703,879,1230],[0,169,321,515,702,885,1067,1230]], 'effect':[]},
 'grim': {'y':[0,160,312,479,639,779,945,1109,1278], 'x':[
  [0,154,308,462,620,769,922,1076,1230],[0,172,346,511,695,868,1054,1230],
  [0,167,339,506,679,858,1054,1230],[0,176,351,523,694,879,1054,1230],
  [0,176,340,506,697,879,1054,1230],[0,176,351,498,655,865,1054,1230],
  [0,169,340,504,676,872,1097,1230],[0,176,335,512,697,867,1061,1230]], 'effect':[(5,4),(6,5)]},
 'valor': {'y':[0,160,320,479,639,791,956,1109,1278], 'x':[
  [0,155,310,465,620,775,930,1230],[0,176,345,525,700,877,1054,1230],
  [0,176,346,507,690,860,1024,1230],[0,176,351,527,703,879,1230],
  [0,176,351,527,703,879,1049,1230],[0,176,351,527,712,879,1048,1230],
  [0,176,351,518,695,885,1078,1230],[0,174,335,507,694,883,1064,1230]], 'effect':[(6,6)]},
 'vesper': {'y':[0,130,256,395,518,647,771,895,1024], 'x':[
  [0,192,384,576,768,960,1152,1344,1536],[0,219,439,658,878,1097,1317,1536],
  [0,219,439,658,878,1097,1317,1536],[0,192,384,576,768,960,1152,1344,1536],
  [0,219,439,658,878,1100,1317,1536],[0,230,495,675,835,990,1170,1340,1536],
  [0,160,330,495,655,886,1335,1536],[0,211,404,631,843,1054,1264,1536]], 'effect':[(6,5)]},
 'rook': {'y':[0,128,256,384,512,640,768,896,1024], 'x':[
  [0,192,384,576,768,960,1152,1344,1536],[0,192,384,576,768,960,1152,1344,1536],
  [0,192,384,576,768,960,1152,1536],[0,192,384,576,768,960,1152,1344,1536],
  [0,192,384,576,768,960,1152,1344,1536],[0,192,384,576,768,960,1152,1344,1536],
  [0,192,384,569,797,960,1152,1344,1536],[0,192,374,555,740,918,1068,1207,1344,1536]], 'effect':[(6,4),(6,5),(6,6),(7,2)]},
}

# Rows have mixed actions, so split only where poses visibly switch action.
def animations(rows, key):
    split = 4 if key != 'rook' else 4
    fall, land = rows[3][:split], rows[3][split:]
    a = {'idle':rows[0], 'walk':rows[1], 'run':rows[1], 'dash':rows[1],
         'jump':rows[2], 'fall':fall, 'land':land, 'jab':rows[4],
         'stilt':rows[4], 'utilt':rows[4], 'dtilt':rows[5],
         'ssmash':rows[5], 'usmash':rows[5], 'dsmash':rows[5],
         'nair':rows[4], 'fair':rows[5], 'bair':rows[4],
         'uair':rows[5], 'dair':rows[5], 'dashattack':rows[7],
         'nspecial':rows[6], 'sspecial':rows[7], 'uspecial':rows[5],
         'dspecial':rows[6] if key == 'grim' else rows[4],
         'crouch':rows[2][:2], 'shield':rows[4][:2], 'rollfwd':rows[1],
         'rollback':rows[1], 'spotdodge':rows[3], 'airdodge':rows[3],
         'hurt':rows[4], 'launch':rows[2], 'grab':rows[4],
         'grabbed':rows[4], 'down':rows[3], 'getup':rows[3],
         'respawn':rows[0], 'ko':rows[3], 'taunt1':rows[0], 'taunt2':rows[0],
         'taunt3':rows[0], 'shieldbreak':rows[4]}
    return a

def key_bg(im, key):
    rgb = np.asarray(im.convert('RGB')).astype(np.int16)
    r,g,b = rgb[:,:,0],rgb[:,:,1],rgb[:,:,2]
    # The field is vivid magenta, including the faint cell lines on Rook's sheet.
    # Preserve non-magenta ink and soften the chroma boundary to suppress fringe.
    # Dark purple afterimages are art, not field. Only pixels close to the
    # bright magenta backing (including its darker grid lines) are keyed.
    a = np.maximum.reduce([np.clip((195-np.minimum(r,b))/40,0,1),
                           np.clip((g-28)/35,0,1),
                           np.clip((np.abs(r-b)-20)/25,0,1)])
    if key == 'rook':
        # This source has printed grid rules. Remove only magenta rule pixels,
        # retaining any non-magenta character/effect ink crossing a rule.
        grid = np.zeros_like(a, dtype=bool)
        for x in range(0, rgb.shape[1], 192): grid[:, max(0,x-2):x+3] = True
        for y in range(0, rgb.shape[0], 128): grid[max(0,y-2):y+3, :] = True
        magenta = (r > 75) & (b > 75) & (g < 65) & (np.minimum(r-g,b-g) > 55)
        a[grid & magenta] = 0
    a[a < 0.12] = 0
    rgba = np.dstack((rgb.clip(0,255).astype('uint8'), (a*255).astype('uint8')))
    return Image.fromarray(rgba, 'RGBA')

def build(key, spec):
    image=Image.open(SRC / (key+'.png')).convert('RGB')
    keyed=key_bg(image, key)
    (OUT/'frames'/key).mkdir(parents=True,exist_ok=True)
    (OUT/'atlas').mkdir(parents=True,exist_ok=True)
    (OUT/'portraits').mkdir(parents=True,exist_ok=True)
    tiles=[]; imgs=[]; rows=[]; source=[]
    for r, xs in enumerate(spec['x']):
        entries=[]
        for c,(x0,x1) in enumerate(zip(xs,xs[1:])):
            y0,y1=spec['y'][r:r+2]
            img=keyed.crop((x0,y0,x1,y1))
            if key == 'rook' and r == 7 and c in (1, 3, 4, 5):
                # These poses overlap translucent purple echoes of the *next*
                # drawing. Remove the echoes here, not the standalone ghost frame.
                px=np.asarray(img).copy().astype(np.int16)
                rr,gg,bb=px[:,:,0],px[:,:,1],px[:,:,2]
                echo=(rr>65)&(bb>65)&(rr>gg+24)&(bb>gg+24)
                px[:,:,3][echo]=0
                img=Image.fromarray(px.astype('uint8'), 'RGBA')
            if key == 'rook' and r == 7 and c == 2:
                # The ghost pose is a complete frame; a fragment of the next
                # pose's trail crosses its right edge in the original image.
                px=np.asarray(img).copy(); px[:, 140:, 3]=0
                img=Image.fromarray(px, 'RGBA')
            bb=img.getchannel('A').getbbox()
            if not bb: raise ValueError(f'{key} row {r+1} frame {c+1} is empty')
            img=img.crop(bb)
            img.save(OUT/'frames'/key/f'{r+1:02d}-{c+1:02d}.png')
            tid=len(imgs); imgs.append(img)
            # Align the cell's character area rather than centering extended beam art.
            # The baseline is the row's bottom, so airborne poses keep their lift.
            nominal = min(x1-x0, (155 if key in ('astra','valor') and r==0 else 192 if key=='rook' else 175 if image.width==1230 else 219))
            ax=nominal/2-bb[0]
            ay=(y1-y0)-bb[1]-8
            if r in (0,1,4,5,6,7) or (r == 3 and (c >= 4 or key == 'grim')):
                ay=img.height  # ground poses sit on the stage, not inside it
            ent=[tid, round(ax,1), round(ay,1), []]
            if (r,c) in spec['effect']:
                # Effect-only frames are still shown in order, over the last real pose.
                base=entries[-1]
                fx_anchor = [round(img.width/2,1), img.height-8] if key == 'grim' else [-30, round(img.height/2+55,1)]
                ent=[base[0],base[1],base[2],[[tid, *fx_anchor]]]
            entries.append(ent); source.append({'row':r+1,'column':c+1,'tile':tid,'effectOnly':(r,c) in spec['effect']})
        rows.append(entries)
    # Reference height from the first idle pose, not a scaled/cropped individual cell.
    ref_h=imgs[0].height
    aw=2048; x=y=2; shelf=0
    for img in imgs:
        if x+img.width+2>aw: x=2;y+=shelf+2;shelf=0
        tiles.append({'x':x,'y':y,'w':img.width,'h':img.height})
        x+=img.width+2;shelf=max(shelf,img.height)
    atlas=Image.new('RGBA',(aw,y+shelf+2))
    for t,img in zip(tiles,imgs): atlas.paste(img,(t['x'],t['y']))
    atlas.save(OUT/'atlas'/f'{key}.png',optimize=True)
    meta={'refH':ref_h,'tiles':tiles,'anims':animations(rows,key),'derived':{},'sourceFrames':source}
    (OUT/'atlas'/f'{key}.json').write_text(json.dumps(meta,separators=(',',':')))
    imgs[0].save(OUT/'portraits'/f'{key}_base.png')
    # Contact sheet of actual output frames for visual inspection, over dark panels.
    W,H=200,150; preview=Image.new('RGB',(W*9,H*8),'#111925'); draw=ImageDraw.Draw(preview)
    for r,xs in enumerate(spec['x']):
        for c in range(len(xs)-1):
            tile=Image.open(OUT/'frames'/key/f'{r+1:02d}-{c+1:02d}.png'); tile.thumbnail((W-8,H-24))
            px=c*W+(W-tile.width)//2; py=r*H+H-tile.height-3
            preview.paste(tile,(px,py),tile); draw.text((c*W+4,r*H+3),f'{r+1}.{c+1}',fill='white')
    review=ROOT.parent/'.cache/sprite-review'; review.mkdir(parents=True,exist_ok=True)
    preview.save(review/f'{key}-frames.png')
    print(f'{key}: {len(imgs)} frames, {atlas.size}, ref height {ref_h}')

if __name__=='__main__':
    for k,spec in SPECS.items(): build(k,spec)
