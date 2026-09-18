import ast
import json
import os
import tempfile
from pathlib import Path
import cv2
import numpy as np

tree = ast.parse(Path('cctv_embeddings.py').read_text(encoding='utf-8'))
functions = ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                            and n.name in ('match', 'quality', 'save_profiles', 'read_profiles')], type_ignores=[])
with tempfile.TemporaryDirectory() as directory:
    scope = dict(np=np, cv2=cv2, json=json, os=os, ROOT=Path(directory),
                 STORE=Path(directory)/'profiles.json', THRESHOLD=0.60, MARGIN=0.08)
    exec(compile(functions, '<profile-functions>', 'exec'), scope)
    match = scope['match']
    assert match([1, 0], {})[0] == 'Unknown'
    assert match([1, 0], {'A': [[1, 0]], 'B': [[0, 1]]})[0] == 'A'
    assert match([-1, 0], {'A': [[1, 0]]})[0] == 'Unknown'
    assert match([1, 0], {'A': [[1, 0]], 'B': [[1, 0.01]]})[0] == 'Unknown'
    profiles = {'ทดสอบ': [[1, 0], [0.9, 0.1]]}
    scope['save_profiles'](profiles)
    assert scope['read_profiles']() == profiles
    try:
        scope['quality'](np.zeros((100, 100, 3), dtype=np.uint8),
                         {'facial_area': {'x': 0, 'y': 0, 'w': 100, 'h': 100}})
        raise AssertionError('Dark enrollment must be rejected')
    except ValueError:
        pass
print('PASS: unknown, known, ambiguity, persistence, dark-image rejection')
