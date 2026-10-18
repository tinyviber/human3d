"""Create an editable parameter-only action spec from the supported-model template."""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--id', required=True, help='lowercase slug, e.g. medicine-ball-push')
    parser.add_argument('--title', help='human-readable action name')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z][a-z0-9-]*', args.id):
        parser.error('--id must match [a-z][a-z0-9-]*')
    destination = ROOT / 'assets/motions' / f'{args.id}.json'
    if destination.exists():
        parser.error(f'{destination.relative_to(ROOT)} already exists; it was left untouched')
    used_orders = [
        json.loads(path.read_text()).get('order', 0)
        for path in (ROOT / 'assets/motions').glob('*.json')
        if not path.name.endswith('.schema.json')
    ]
    envelope = json.loads((ROOT / 'docs/templates/muscle-action.template.json').read_text())
    envelope['id'] = args.id
    envelope['order'] = max(used_orders, default=0) + 1
    action = envelope['dynamics']['action']
    action['id'] = args.id
    action['title'] = args.title or args.id.replace('-', ' ').title()
    action['display']['english'] = args.id.replace('-', ' ').upper()
    for ref in envelope['dynamics']['records'].values():
        for key in ('meta', 'data'):
            ref[key] = ref[key].replace('example-action', args.id)
    destination.write_text(json.dumps(envelope, ensure_ascii=False, indent=2) + '\n')
    print(f'Created {destination.relative_to(ROOT)}')
    print('Edit dynamics.action display/reference.keyframes and source attribution; '
          'add the envelope to packages/motion-core/src/motion-files.ts; then run `npm run dynamics:build -- <id>`.')


if __name__ == '__main__':
    main()
