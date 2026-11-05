"""Generate disjoint PGO training and heldout panels and time installed native core."""
import hashlib
import json
from pathlib import Path
import platform
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'packages/optimizer'))
from flexo import api, _core
from experiments.benchmark import ORIGINAL_PARAMETERS
from flexo.instances import generate_smac

root = Path(__file__).resolve().parents[1]
out = root / 'packages/optimizer/tmp/wasm-performance'
out.mkdir(parents=True, exist_ok=True)
parameters = dict(ORIGINAL_PARAMETERS, starts=1, evaluations=1_000_000)
generate_smac(root / 'packages/optimizer/instances/smac', replicas=2)
rows = []
for panel, replica, seeds in [('train', '00', [42, 43]), ('heldout', '01', [142, 143, 144])]:
    for size in [10, 30, 50, 100]:
        for kind in ['clean', 'carryover']:
            name = f'N{size}_{kind}_{replica}'
            snapshot = json.loads((root / f'packages/optimizer/instances/smac/{panel if panel == "train" else "heldout"}/{name}.json').read_text())
            captured = []
            original = _core.Problem
            def capture(data):
                captured.append(data)
                return original(data)
            _core.Problem = capture
            try:
                prepared = api.prepare(snapshot)
            finally:
                _core.Problem = original
            config = dict(parameters, evaluations=100_000) if panel == 'train' else parameters
            prepared.core.solve(dict(config, evaluations=20_000), seeds[0], 1)
            samples = []
            for seed in seeds:
                timings = []
                for repeat in range(3 if panel == 'heldout' else 1):
                    result = prepared.core.solve(config, seed, 1)
                    timings.append(result['runtime'] * 1000)
                samples.append(dict(seed=str(seed), native_ms=timings, native_result=result))
            rows.append(dict(name=name, panel=panel, snapshot=snapshot, problem=captured[0], parameters=config, samples=samples))
metadata = dict(platform=platform.platform(), native_sha256=hashlib.sha256(Path(_core.__file__).read_bytes()).hexdigest(), rows=rows)
(out / 'input.json').write_text(json.dumps(metadata))
print('Native timings and disjoint training/heldout inputs saved.', flush=True)
