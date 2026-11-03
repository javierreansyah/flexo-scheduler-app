import hashlib
import json
from types import SimpleNamespace

import pytest

from flexo import fixed_tuning as module


def test_verified_transition_preserves_strict_resume_checks(tmp_path, monkeypatch):
    binary = tmp_path/'core.pyd'
    binary.write_bytes(b'optimized')
    monkeypatch.setattr(module, '_core', SimpleNamespace(__file__=str(binary)))
    monkeypatch.setattr(module, 'load_dataset', lambda _: ({}, 'dataset'))
    work = tmp_path/'campaign'
    manifest = module.tune_fixed(workdir=work, validate_only=True)
    transition = dict(new_core_sha256=hashlib.sha256(b'optimized').hexdigest(),
                      old_core_sha256='old', dataset_sha256='dataset')
    (work/'build-transition.json').write_text(json.dumps(transition))
    manifest['build_transition_sha256'] = module.fingerprint(transition)
    (work/'manifest.json').write_text(json.dumps(manifest))
    assert module.tune_fixed(workdir=work, resume=True, validate_only=True) == manifest
    with pytest.raises(ValueError, match='Resume settings'):
        module.tune_fixed(workdir=work, resume=True, validate_only=True, trials=401)
    binary.write_bytes(b'unrelated')
    with pytest.raises(ValueError, match='does not match binary'):
        module.tune_fixed(workdir=work, resume=True, validate_only=True)
