"""Replay observation timing and operator association without GPU or sleeping."""
import argparse
import json
from pathlib import Path
import sys

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'src'))
from jetson_worktime.behavior import SessionEngine
from jetson_worktime.ownership import valid_track_id
from jetson_worktime.localization import reason


def replay(input_path, config, output, events_path=None):
    if output.exists():
        raise SystemExit('output already exists')
    output.parent.mkdir(parents=True, exist_ok=True)
    engine = SessionEngine(config, run_id='offline-replay')
    events = []
    if events_path is not None:
        events = [json.loads(line) for line in events_path.read_text().splitlines()]
        events = [e for e in events if e['event'] == 'operator_return_confirmed']
        events.sort(key=lambda e: e['confirmed_monotonic_seconds'])
    event_index = 0
    def confirmations(until):
        nonlocal event_index
        while event_index < len(events) and events[event_index]['confirmed_monotonic_seconds'] <= until:
            event = events[event_index]
            matches = [p for p in engine.persons if p.get('person_track_id') == event['ownership']['track_id']
                       and p.get('ownership_zone') == 'SEATED']
            if len(matches) != 1:
                raise ValueError('confirmation lacks its recorded tracked candidate')
            engine.confirm_return(matches[0], event['monotonic_seconds'],
                event['confirmed_monotonic_seconds'], observation_id=event['observation_id'])
            event_index += 1
    with input_path.open() as source, output.open('x') as destination:
        for line in source:
            record = json.loads(line)
            frame = record.get('frame') or record
            t = int(frame['receive_monotonic_ns']) / 1e9
            stream = frame.get('stream_session_id', frame.get('session_id', 'legacy'))
            confirmations(t)
            people = record['persons']
            sequence = frame.get('receive_sequence')
            blocked = None
            if record.get('camera_changed'):
                blocked = reason('reason.moved')
            elif record.get('roi_configured') is False:
                blocked = reason('source.roiRequired')
            elif record.get('ownership', {}).get('state') == 'INPUT_UNKNOWN':
                blocked = reason(record.get('reason_code') or 'reason.unknown', **record.get('reason_params', {}))
            accepted = engine.observe_persons(t, people,
                frame.get('source_width', record.get('width')),
                frame.get('source_height', record.get('height')), stream, sequence=sequence, blocked_reason=blocked)
            verified = bool(people) and all(valid_track_id(p.get('person_track_id')) for p in people)
            status = engine.snapshot(t)
            if not verified:
                status['ownership']['verification'] = 'UNVERIFIED'
            destination.write(json.dumps(dict(frame_ref=sequence, accepted=accepted,
                ownership_verification='TRACK_EVIDENCE_AVAILABLE' if verified else 'UNVERIFIED',
                status=status), ensure_ascii=False)+'\n')
    if event_index < len(events):
        confirmations(events[-1]['confirmed_monotonic_seconds'])
    return engine


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--config', default='configs/behavior.yaml')
    parser.add_argument('--output', required=True)
    parser.add_argument('--events', help='matching events.jsonl to reproduce recorded manual return confirmations')
    args = parser.parse_args()
    engine = replay(Path(args.input), yaml.safe_load(Path(args.config).read_text()), Path(args.output),
                    Path(args.events) if args.events else None)
    print(json.dumps(engine.snapshot(engine.last_obs or 0), ensure_ascii=False))
