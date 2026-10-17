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
    destination = ROOT / 'assets/actions' / f'{args.id}.json'
    if destination.exists():
        parser.error(f'{destination.relative_to(ROOT)} already exists; it was left untouched')
    spec = json.loads((ROOT / 'docs/templates/muscle-action.template.json').read_text())
    spec['id'] = args.id
    spec['title'] = args.title or args.id.replace('-', ' ').title()
    spec['display']['english'] = args.id.replace('-', ' ').upper()
    destination.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + '\n')
    print(f'Created {destination.relative_to(ROOT)}')
    print('Edit display, reference.keyframes, and source attribution; then run `npm run dynamics:build -- <id>`.')


if __name__ == '__main__':
    main()
