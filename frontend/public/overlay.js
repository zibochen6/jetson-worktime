import {tr} from './i18n.js';

const browser = typeof window !== 'undefined' && typeof document !== 'undefined';
const styleURL = new URL('./overlay-style.json', import.meta.url);
export const overlayStyle = browser
  ? await (await fetch(styleURL, {cache:'no-store'})).json()
  : JSON.parse(await (await import('node:fs/promises')).readFile(styleURL, 'utf8'));

if (browser) {
  for (const [name, color] of Object.entries(overlayStyle.colors)) {
    document.documentElement.style.setProperty('--overlay-'+name.replaceAll('_','-'), color);
  }
  document.documentElement.style.setProperty('--station', overlayStyle.colors.station);
  document.documentElement.style.setProperty('--seat', overlayStyle.colors.seat);
}

export function overlayDimensions(width) {
  const scale = Math.max(.65, Math.min(1.6, width/overlayStyle.reference_width));
  const keys = ['line_width','corner_width','point_radius','anchor_radius','label_padding_x',
    'label_padding_y','label_gap','margin','dash_length','dash_gap','label_radius'];
  const result = Object.fromEntries(keys.map(key => [key, Math.max(1, Math.round(overlayStyle[key]*scale))]));
  result.font_size = Math.max(overlayStyle.font_min, Math.min(overlayStyle.font_max, Math.round(overlayStyle.font_size*scale)));
  result.corner_min = overlayStyle.corner_min*scale;
  result.corner_max = overlayStyle.corner_max*scale;
  return result;
}

export function cornerSegments([x1,y1,x2,y2], metrics) {
  let length = Math.min(metrics.corner_max, Math.max(metrics.corner_min, Math.min(x2-x1,y2-y1)*overlayStyle.corner_fraction));
  length = Math.max(0, Math.min(length,(x2-x1)/2,(y2-y1)/2));
  return [[x1,y1,1,1],[x2,y1,-1,1],[x1,y2,1,-1],[x2,y2,-1,-1]].map(([x,y,dx,dy]) =>
    [[Math.round(x),Math.round(y)],[Math.round(x+dx*length),Math.round(y)],[Math.round(x),Math.round(y+dy*length)]]);
}

export function placeOverlayLabels(labels, width, height, metrics) {
  const placed = [];
  const margin = metrics.margin, gap = metrics.label_gap;
  for (const label of labels) {
    if (label.width > width-2*margin || label.height > height-2*margin) continue;
    const x = Math.max(margin, Math.min(Math.round(label.x),width-label.width-margin));
    const preferred = Math.max(margin, Math.min(Math.round(label.y),height-label.height-margin));
    const offsets = [0];
    for (let step=1; step<=6; step++) offsets.push(step*(label.height+gap),-step*(label.height+gap));
    for (const offset of offsets) {
      const y = preferred+offset;
      if (y<margin || y+label.height>height-margin) continue;
      if (placed.some(old => x<old.x+old.width+gap && x+label.width+gap>old.x && y<old.y+old.height+gap && y+label.height+gap>old.y)) continue;
      placed.push({...label,x,y});
      break;
    }
  }
  return placed;
}

function inside(point, polygon) {
  let result = false;
  for (let i=0,j=polygon.length-1; i<polygon.length; j=i++) {
    const a=polygon[i],b=polygon[j];
    if ((a[1]>point[1]) !== (b[1]>point[1]) && point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) result=!result;
  }
  return result;
}

export function drawDetectionOverlay(canvas, image, observation, {fresh=true, regionsMatch=true}={}) {
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image,0,0);
  if (!regionsMatch) return;
  const metrics = overlayDimensions(canvas.width);
  const colors = overlayStyle.colors;
  const display = observation.display || overlayStyle.defaults;
  const sx = canvas.width/observation.frame.source_width;
  const sy = canvas.height/observation.frame.source_height;
  const xy = point => [Math.round(point[0]*sx),Math.round(point[1]*sy)];
  const regions = [], people = [], anchors = [];
  ctx.save();
  ctx.font = `${metrics.font_size}px "Noto Sans CJK SC", sans-serif`;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const labelHeight = metrics.font_size+2+2*metrics.label_padding_y;
  function label(x,y,key,color) {
    let value = tr(key), original = value;
    const maxWidth = canvas.width-2*metrics.margin-2*metrics.label_padding_x;
    while (value && ctx.measureText(value).width>maxWidth) {
      original=original.slice(0,-1);
      value=original?original+'…':'';
    }
    return {x,y,text:value,color,width:Math.min(canvas.width-2*metrics.margin,Math.ceil(ctx.measureText(value).width)+2*metrics.label_padding_x),height:labelHeight};
  }
  if (display.regions) {
    for (const name of ['station','seat']) {
      const points = observation.regions[name];
      if (!points?.length) continue;
      ctx.beginPath();
      points.map(xy).forEach(([x,y],i) => i?ctx.lineTo(x,y):ctx.moveTo(x,y));
      ctx.closePath();
      if (name==='seat') {
        ctx.globalAlpha=overlayStyle.seat_fill_alpha;
        ctx.fillStyle=colors.seat;
        ctx.fill();
        ctx.globalAlpha=1;
      }
      ctx.setLineDash(name==='station'?[metrics.dash_length,metrics.dash_gap]:[]);
      ctx.lineWidth=metrics.line_width;
      ctx.strokeStyle=colors[name];
      ctx.stroke();
      ctx.setLineDash([]);
      const origin=points.map(xy).sort((a,b)=>a[1]-b[1]||a[0]-b[0])[0];
      regions.push(label(origin[0]+metrics.label_gap,origin[1]+metrics.label_gap,'overlay.'+name,colors[name]));
    }
  }
  for (const person of fresh && observation.inference?.accepted!==false?observation.persons:[]) {
    const [x1,y1]=xy(person.bbox_xyxy.slice(0,2)),[x2,y2]=xy(person.bbox_xyxy.slice(2));
    ctx.strokeStyle=colors.person;
    ctx.fillStyle=colors.person;
    if (display.boxes) {
      ctx.lineWidth=metrics.corner_width;
      for (const [origin,horizontal,vertical] of cornerSegments([x1,y1,x2,y2],metrics)) {
        ctx.beginPath();ctx.moveTo(...horizontal);ctx.lineTo(...origin);ctx.lineTo(...vertical);ctx.stroke();
      }
      const top=y1-labelHeight-metrics.label_gap;
      people.push(label(x1+metrics.label_gap,top<metrics.margin?y1+metrics.label_gap:top,'overlay.person',colors.person));
    }
    if (!display.keypoints) continue;
    ctx.lineWidth=metrics.line_width;
    const valid=point => point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.confidence>=(observation.detection?.keypoint_confidence ?? .4);
    const points=person.keypoints;
    for (const [a,b] of overlayStyle.skeleton_edges) {
      if (valid(points[a]) && valid(points[b])) {
        ctx.beginPath();ctx.moveTo(...xy([points[a].x,points[a].y]));ctx.lineTo(...xy([points[b].x,points[b].y]));ctx.stroke();
      }
    }
    for (const point of points.slice(observation.privacy_applied?5:0)) {
      if (!valid(point)) continue;
      ctx.beginPath();ctx.arc(...xy([point.x,point.y]),metrics.point_radius,0,2*Math.PI);ctx.fill();
    }
    if (person.upper_body_anchor) {
      const point=xy(person.upper_body_anchor);
      ctx.strokeStyle=colors.anchor;
      ctx.beginPath();ctx.arc(...point,metrics.anchor_radius,0,2*Math.PI);ctx.stroke();
      const key=inside(person.upper_body_anchor,observation.regions.seat)?'overlay.inside':'overlay.outside';
      anchors.push(label(point[0]+metrics.anchor_radius+metrics.label_gap,point[1]+metrics.label_gap,key,colors.anchor));
    }
  }
  for (const item of placeOverlayLabels([...people,...anchors,...regions],canvas.width,canvas.height,metrics)) {
    ctx.globalAlpha=overlayStyle.label_alpha;
    ctx.fillStyle=colors.label_background;
    ctx.beginPath();ctx.roundRect(item.x,item.y,item.width,item.height,metrics.label_radius);ctx.fill();
    ctx.globalAlpha=1;
    ctx.strokeStyle=item.color;
    ctx.lineWidth=metrics.corner_width;
    ctx.beginPath();ctx.moveTo(item.x+1,item.y+metrics.label_padding_y);ctx.lineTo(item.x+1,item.y+item.height-metrics.label_padding_y);ctx.stroke();
    ctx.fillStyle=colors.label_text;
    ctx.textBaseline='middle';
    ctx.fillText(item.text,item.x+metrics.label_padding_x,item.y+item.height/2);
  }
  ctx.restore();
}
