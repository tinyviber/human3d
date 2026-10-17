"""Validate, forward-simulate, and export one parameterized MyoSim action."""
import argparse
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action_id', help='action JSON basename in assets/actions')
    action_id = parser.parse_args().action_id

    validation = runpy.run_path(str(ROOT / 'scripts/validate-action-spec.py'))
    validation['validate_archive']()
    print('Validated full MyoSim archive.', flush=True)
    print('Action spec:', validation['validate_action'](ROOT / f'assets/actions/{action_id}.json'), flush=True)

    preparation = runpy.run_path(str(ROOT / 'scripts/prepare-muscle-actions.py'))
    preparation['configure_action'](action_id)
    reference = preparation['references'](action_id)
    if reference.get('armControl') == 'joint-keyframes':
        print(f"Reference {action_id}: {reference['duration']:.3f}s; bounded shoulder quaternion + elbow hinge targets; "
              f"minimum forearm clearance {reference.get('minArmClearanceM', 0):.4f}m", flush=True)
    else:
        print(f"Reference {action_id}: {reference['duration']:.3f}s; max arm target error "
              f"{reference.get('maxArmTargetErrorM', 0):.4f}m; minimum clearance "
              f"{reference.get('minArmClearanceM', 0):.4f}m", flush=True)
    baseline_run = preparation['simulate'](action_id, reference, 'baseline')
    preparation['configure_action'](action_id)
    weak_run = preparation['simulate'](action_id, reference, 'weak')

    exporter = runpy.run_path(str(ROOT / 'scripts/export-simulation.py'))
    baseline = exporter['export'](action_id, 'baseline')
    weak = exporter['export'](action_id, 'weak')
    print('Baseline forward simulation:', baseline_run['peaks'], flush=True)
    print('Reduced-capacity forward simulation:', weak_run['peaks'], flush=True)
    print('Baseline audit:', baseline['audit'], flush=True)
    print('Capacity perturbation audit:', weak['audit'], flush=True)
    print('Run `npm run build` to include this JSON-defined action in the web catalog.', flush=True)


if __name__ == '__main__':
    main()
