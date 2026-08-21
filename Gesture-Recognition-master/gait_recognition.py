import json
import os
from typing import Dict, List
import numpy as np

# Path to the JSON file storing gait templates. It lives alongside this module.
PROFILE_PATH = os.path.join(os.path.dirname(__file__), "gait_profiles.json")

def _ensure_profile_file():
    """Create an empty profile file if it does not exist."""
    if not os.path.exists(PROFILE_PATH):
        with open(PROFILE_PATH, "w", encoding="utf-8") as f:
            json.dump({}, f)

def load_profiles() -> Dict[str, List[np.ndarray]]:
    """Load gait profiles from JSON.

    Returns:
        A dict mapping a person name to a list of feature vectors (as NumPy arrays).
    """
    _ensure_profile_file()
    with open(PROFILE_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    # Convert nested Python lists to NumPy arrays for distance calculations
    profiles: Dict[str, List[np.ndarray]] = {}
    for name, vectors in raw.items():
        profiles[name] = [np.array(v, dtype=float) for v in vectors]
    return profiles

def _save_profiles(profiles: Dict[str, List[np.ndarray]]):
    """Write the profiles dict back to the JSON file."""
    serializable = {name: [vec.tolist() for vec in vecs] for name, vecs in profiles.items()}
    with open(PROFILE_PATH, "w", encoding="utf-8") as f:
        json.dump(serializable, f, indent=2)

def register_gait(name: str, features: np.ndarray):
    """Register a new gait feature vector for *name*.

    Args:
        name: Identifier for the person (e.g., "Alice").
        features: Feature vector produced by ``extract_features``.
    """
    profiles = load_profiles()
    if name not in profiles:
        profiles[name] = []
    profiles[name].append(np.array(features, dtype=float))
    _save_profiles(profiles)

def identify_gait(features: np.ndarray, profiles: Dict[str, List[np.ndarray]], threshold: float = 0.2) -> str | None:
    """Identify the walker based on gait features.

    Uses a simple nearest‑neighbor Euclidean distance on **unit‑normalized** vectors.
    If the best distance (scaled to [0,1]) is below *threshold*, the associated name
    is returned; otherwise ``None`` is returned.
    """
    if not profiles:
        return None
    # Normalise the incoming feature vector
    norm_feat = features / (np.linalg.norm(features) + 1e-8)
    best_name = None
    best_dist = float("inf")
    for name, vecs in profiles.items():
        for vec in vecs:
            norm_vec = vec / (np.linalg.norm(vec) + 1e-8)
            dist = np.linalg.norm(norm_feat - norm_vec)
            if dist < best_dist:
                best_dist = dist
                best_name = name
    # Normalised distance (0‑2) -> map to 0‑1 for easier thresholding
    norm_distance = best_dist / 2.0
    if norm_distance <= threshold:
        return best_name
    return None
