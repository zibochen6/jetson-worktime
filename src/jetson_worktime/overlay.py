"""Frame-matched industrial overlays shared by live, offline and diagnostic media."""
from collections import OrderedDict
from functools import lru_cache
import json
import math
from pathlib import Path
import threading

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .behavior import point_in_polygon
from .localization import translate, LANGUAGES

STYLE = json.loads((Path(__file__).resolve().parents[2]/'frontend/public/overlay-style.json').read_text())
COLORS = {name: tuple(bytes.fromhex(value[1:])[::-1]) for name, value in STYLE['colors'].items()}
TITLES = {'station': 'overlay.station', 'seat': 'overlay.seat'}
_CACHE = OrderedDict()
_CACHE_LOCK = threading.Lock()


def dimensions(width):
    scale = max(.65, min(1.6, width/STYLE['reference_width']))
    values = {key: max(1, round(STYLE[key]*scale)) for key in (
        'line_width', 'corner_width', 'point_radius', 'anchor_radius', 'label_padding_x',
        'label_padding_y', 'label_gap', 'margin', 'dash_length', 'dash_gap', 'label_radius')}
    values['font_size'] = max(STYLE['font_min'], min(STYLE['font_max'], round(STYLE['font_size']*scale)))
    values['corner_min'] = STYLE['corner_min']*scale
    values['corner_max'] = STYLE['corner_max']*scale
    return values


@lru_cache(maxsize=16)
def _font(size):
    return ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', size)


def _dash_segments(points, dash, gap):
    segments = []
    for a, b in zip(points, points[1:]+points[:1]):
        length = math.dist(a, b)
        if not length:
            continue
        a, b = np.asarray(a), np.asarray(b)
        for distance in range(0, math.ceil(length), dash+gap):
            start = np.rint(a+(b-a)*distance/length).astype(int)
            end = np.rint(a+(b-a)*min(distance+dash, length)/length).astype(int)
            segments.append((tuple(int(v) for v in start), tuple(int(v) for v in end)))
    return segments


def _sprite(text, color, metrics, max_width):
    font = _font(metrics['font_size'])
    measure = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    padding_x, padding_y = metrics['label_padding_x'], metrics['label_padding_y']
    available = max(1, max_width-2*padding_x)
    original = text
    while text and measure.textlength(text, font=font) > available:
        original = original[:-1]
        text = original+'…' if original else ''
    bounds = measure.textbbox((0, 0), text, font=font)
    width = min(max_width, max(1, math.ceil(measure.textlength(text, font=font))+2*padding_x))
    text_height = metrics['font_size']+2
    height = text_height+2*padding_y
    image = Image.new('RGBA', (width, height))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, width-1, height-1), radius=metrics['label_radius'],
                           fill=tuple(reversed(COLORS['label_background']))+(round(255*STYLE['label_alpha']),))
    draw.line((1, padding_y, 1, height-padding_y-1), fill=tuple(reversed(color))+(230,),
              width=metrics['corner_width'])
    draw.text((padding_x, padding_y-bounds[1]+max(0, (text_height-(bounds[3]-bounds[1]))//2)),
              text, font=font, fill=tuple(reversed(COLORS['label_text']))+(255,))
    sprite = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGBA2BGRA)
    alpha = sprite[..., 3:4].astype(np.float32)/255
    return dict(pixels=sprite[..., :3].astype(np.float32)*alpha, inverse=1-alpha, width=width, height=height)


def _build(width, height, config, locale):
    metrics = dimensions(width)
    scale_x, scale_y = width/config['image_size'][0], height/config['image_size'][1]
    polygons = {name: [(round(p[0]*scale_x), round(p[1]*scale_y)) for p in config['regions'][name]] for name in TITLES}
    # Cache the tint LUT and clipped mask. A four-percent fill needs no per-frame float image.
    mask = np.zeros((height, width), np.uint8)
    cv2.fillPoly(mask, [np.asarray(polygons['seat'], np.int32)], 255)
    bounds = cv2.boundingRect(mask)
    x, y, w, h = bounds
    alpha = STYLE['seat_fill_alpha']
    lut = np.rint(np.arange(256)[:, None]*(1-alpha)+np.asarray(COLORS['seat'])[None, :]*alpha).astype(np.uint8)
    keys = [(TITLES['station'], COLORS['station']), (TITLES['seat'], COLORS['seat']),
            ('overlay.person', COLORS['person']), ('overlay.inside', COLORS['anchor']),
            ('overlay.outside', COLORS['anchor'])]
    return dict(metrics=metrics, scale_x=scale_x, scale_y=scale_y, polygons=polygons,
                station_segments=_dash_segments(polygons['station'], metrics['dash_length'], metrics['dash_gap']),
                fill_bounds=bounds, fill_mask=mask[y:y+h, x:x+w], fill_lut=lut.reshape(256, 1, 3),
                sprites={key: _sprite(translate(key, locale=locale), color, metrics, max(1, width-2*metrics['margin'])) for key, color in keys})


def _layer(width, height, config, locale):
    key = (width, height, locale, config.get('revision', 0),
           json.dumps([config['image_size'], config['regions']], sort_keys=True))
    with _CACHE_LOCK:
        if key not in _CACHE:
            _CACHE[key] = _build(width, height, config, locale)
            if len(_CACHE) > 8:
                _CACHE.popitem(last=False)
        _CACHE.move_to_end(key)
        return _CACHE[key]


def corner_segments(box, metrics):
    x1, y1, x2, y2 = box
    length = min(metrics['corner_max'], max(metrics['corner_min'], min(x2-x1, y2-y1)*STYLE['corner_fraction']))
    length = max(0, min(length, (x2-x1)/2, (y2-y1)/2))
    return [((round(x), round(y)), (round(x+dx*length), round(y)),
             (round(x), round(y+dy*length)))
            for x, y, dx, dy in ((x1, y1, 1, 1), (x2, y1, -1, 1), (x1, y2, 1, -1), (x2, y2, -1, -1))]


def place_labels(labels, sprites, width, height, metrics):
    """Keep labels inside the image. Omit a crowded label when no free slot remains."""
    placed = []
    margin, gap = metrics['margin'], metrics['label_gap']
    for x, y, key in labels:
        sprite = sprites[key]
        w, h = sprite['width'], sprite['height']
        if w > width-2*margin or h > height-2*margin:
            continue
        x = max(margin, min(round(x), width-w-margin))
        preferred = max(margin, min(round(y), height-h-margin))
        offsets = [0]+[direction*step*(h+gap) for step in range(1, 7) for direction in (1, -1)]
        for offset in offsets:
            top = preferred+offset
            if top < margin or top+h > height-margin:
                continue
            if any(x < old_x+old_w+gap and x+w+gap > old_x and top < old_y+old_h+gap and top+h+gap > old_y
                   for old_x, old_y, old_w, old_h, _ in placed):
                continue
            placed.append((x, top, w, h, key))
            break
    return placed


def draw_overlay(frame, persons, config, fresh=True, locale='zh-CN'):
    """Draw enabled layers in place after privacy protection, using this frame's detections."""
    height, width = frame.shape[:2]
    layer = _layer(width, height, config, locale)
    metrics = layer['metrics']
    display = config.get('display', STYLE['defaults'])
    def xy(point):
        return round(point[0]*layer['scale_x']), round(point[1]*layer['scale_y'])
    region_labels, person_labels, anchor_labels = [], [], []
    if display['regions']:
        x, y, w, h = layer['fill_bounds']
        if w and h:
            patch = frame[y:y+h, x:x+w]
            cv2.copyTo(cv2.LUT(patch, layer['fill_lut']), layer['fill_mask'], patch)
        for a, b in layer['station_segments']:
            cv2.line(frame, a, b, COLORS['station'], metrics['line_width'], cv2.LINE_AA)
        cv2.polylines(frame, [np.asarray(layer['polygons']['seat'], np.int32)], True,
                      COLORS['seat'], metrics['line_width'], cv2.LINE_AA)
        for name, title in TITLES.items():
            x, y = min(layer['polygons'][name], key=lambda p: (p[1], p[0]))
            region_labels.append((x+metrics['label_gap'], y+metrics['label_gap'], title))
    if fresh:
        for person in persons:
            box = person['bbox_xyxy']
            a, b = xy(box[:2]), xy(box[2:])
            if display['boxes']:
                for origin, horizontal, vertical in corner_segments((*a, *b), metrics):
                    cv2.line(frame, origin, horizontal, COLORS['person'], metrics['corner_width'], cv2.LINE_AA)
                    cv2.line(frame, origin, vertical, COLORS['person'], metrics['corner_width'], cv2.LINE_AA)
                label_height = layer['sprites']['overlay.person']['height']
                label_y = a[1]-label_height-metrics['label_gap']
                if label_y < metrics['margin']:
                    label_y = a[1]+metrics['label_gap']
                person_labels.append((a[0]+metrics['label_gap'], label_y, 'overlay.person'))
            if not display['keypoints']:
                continue
            points = person['keypoints']
            def valid(index):
                return (len(points) > index and points[index].get('x') is not None and points[index].get('y') is not None
                        and (points[index].get('confidence') or 0) >= config.get('keypoint_confidence', .4))
            for i, j in STYLE['skeleton_edges']:
                if valid(i) and valid(j):
                    cv2.line(frame, xy((points[i]['x'], points[i]['y'])), xy((points[j]['x'], points[j]['y'])),
                             COLORS['person'], metrics['line_width'], cv2.LINE_AA)
            for i in range(5 if config.get('privacy', {}).get('enabled', True) else 0, len(points)):
                if valid(i):
                    cv2.circle(frame, xy((points[i]['x'], points[i]['y'])), metrics['point_radius'], COLORS['person'], -1, cv2.LINE_AA)
            anchor = person.get('upper_body_anchor')
            if anchor:
                point = xy(anchor)
                cv2.circle(frame, point, metrics['anchor_radius'], COLORS['anchor'], metrics['line_width'], cv2.LINE_AA)
                key = 'overlay.inside' if point_in_polygon(anchor, config['regions']['seat']) else 'overlay.outside'
                anchor_labels.append((point[0]+metrics['anchor_radius']+metrics['label_gap'], point[1]+metrics['label_gap'], key))
    for x, y, w, h, key in place_labels(person_labels+anchor_labels+region_labels, layer['sprites'], width, height, metrics):
        sprite = layer['sprites'][key]
        patch = frame[y:y+h, x:x+w]
        patch[:] = np.rint(sprite['pixels']+patch*sprite['inverse']).astype(np.uint8)
    return frame


def encode_overlays(frame, persons, config, fresh=True, regions_match=True):
    """Encode language variants from a single protected image and its matching result."""
    variants = {}
    for locale in LANGUAGES:
        marked = frame.copy()
        if regions_match:
            draw_overlay(marked, persons, config, fresh=fresh, locale=locale)
        ok, encoded = cv2.imencode('.jpg', marked, [cv2.IMWRITE_JPEG_QUALITY, 78])
        if not ok:
            raise RuntimeError('Annotation encoding failed')
        variants[locale] = encoded.tobytes()
    return variants
